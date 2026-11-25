import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "@/lib/config";
import { saveUsage, type AiContext } from "./usage";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type { AiContext };

let client: Anthropic | undefined;
function anthropic() {
  client ??= new Anthropic({ maxRetries: 4, timeout: 10 * 60_000 });
  return client;
}

/** Tarifs ($ / million de tokens) — sert uniquement à estimer le coût affiché. */
const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
const WEB_SEARCH_USD = 10 / 1000;

/** Modèles qui acceptent le repli serveur en cas de refus (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Outil de recherche web côté serveur. La variante à filtrage dynamique (20260209) n'existe
 * que sur les modèles Fable / Mythos / Opus / Sonnet récents ; Haiku utilise la variante de base.
 */
function webSearchTool(model: string, maxUses: number): Anthropic.Beta.BetaToolUnion {
  if (/haiku/.test(model)) return { type: "web_search_20250305", name: "web_search", max_uses: maxUses };
  return { type: "web_search_20260209", name: "web_search", max_uses: maxUses };
}

function fallbackParams(model: string) {
  return FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {};
}

async function recordUsage(ctx: AiContext, operation: string, model: string, usage: Anthropic.Beta.BetaUsage) {
  const price = PRICING[model] ?? PRICING["claude-opus-5-5"];
  const input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const webSearches = usage.server_tool_use?.web_search_requests ?? 0;
  const costUsd =
    (input * price.input + cacheRead * price.cacheRead + usage.output_tokens * price.output) / 1_000_000 +
    webSearches * WEB_SEARCH_USD;
  await saveUsage(ctx, { operation, model, inputTokens: input, outputTokens: usage.output_tokens, cacheReadTokens: cacheRead, webSearches, costUsd });
}

export class AiRefusalError extends Error {}

/**
 * Appel unique à sortie structurée (JSON validé par Zod).
 * Utilisé pour la planification, l'analyse d'entreprise, le scoring et la rédaction.
 */
export async function structured<S extends z.ZodType>(opts: {
  operation: string;
  ctx: AiContext;
  schema: S;
  system: string;
  prompt: string;
  fast?: boolean;
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const model = opts.fast ? config.ai.fastModel : config.ai.model;
  const stream = anthropic().beta.messages.stream({
    model,
    max_tokens: opts.maxTokens ?? 32000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.prompt }],
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
    ...fallbackParams(model),
  });
  const msg = await stream.finalMessage();
  await recordUsage(opts.ctx, opts.operation, model, msg.usage);
  if (msg.stop_reason === "refusal") throw new AiRefusalError(`Requête refusée par le modèle (${opts.operation})`);
  if (msg.stop_reason === "max_tokens") throw new Error(`Réponse tronquée (max_tokens) pour ${opts.operation}`);
  const text = msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return opts.schema.parse(JSON.parse(text));
}

export type ResearchResult<T> = { data: T; sources: string[] };

/**
 * Agent de recherche web : Claude effectue lui-même ses recherches (outil web_search
 * côté serveur), puis rend ses conclusions via l'outil strict `submit_results`.
 */
export async function research<S extends z.ZodType>(opts: {
  operation: string;
  ctx: AiContext;
  schema: S;
  system: string;
  prompt: string;
  maxSearches?: number;
  effort?: Effort;
  fast?: boolean;
}): Promise<ResearchResult<z.infer<S>>> {
  const model = opts.fast ? config.ai.fastModel : config.ai.model;
  const submitTool: Anthropic.Beta.BetaTool = {
    name: "submit_results",
    description:
      "Soumet le résultat final de la recherche. À appeler exactement une fois, à la fin, avec toutes les informations trouvées.",
    input_schema: betaZodOutputFormat(opts.schema).schema as Anthropic.Beta.BetaTool.InputSchema,
    strict: true,
  };
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    webSearchTool(model, opts.maxSearches ?? 8),
    submitTool,
  ];
  const system =
    `${opts.system}\n\nQuand ta recherche est terminée, appelle l'outil submit_results avec le résultat ` +
    `(n'écris pas le résultat en texte). N'invente jamais d'information : uniquement ce que tu as trouvé.`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  const sources = new Set<string>();

  for (let turn = 0; turn < 6; turn++) {
    const stream = anthropic().beta.messages.stream({
      model,
      max_tokens: 64000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      tools,
      tool_choice: { type: "auto" },
      output_config: { effort: opts.effort ?? "medium" },
      ...fallbackParams(model),
    });
    const msg = await stream.finalMessage();
    await recordUsage(opts.ctx, opts.operation, model, msg.usage);

    for (const block of msg.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) sources.add(r.url);
      }
    }
    if (msg.stop_reason === "refusal") throw new AiRefusalError(`Recherche refusée par le modèle (${opts.operation})`);

    const submit = msg.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "submit_results",
    );
    if (submit) {
      const parsed = opts.schema.safeParse(submit.input);
      if (parsed.success) return { data: parsed.data, sources: [...sources] };
      messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: submit.id,
            is_error: true,
            content: `Entrée invalide : ${parsed.error.message.slice(0, 1500)}. Corrige et rappelle submit_results.`,
          },
        ],
      });
      continue;
    }

    messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (msg.stop_reason === "pause_turn") continue; // le serveur reprend la boucle d'outils
    messages.push({
      role: "user",
      content: "Termine maintenant : appelle submit_results avec ce que tu as trouvé (listes vides si rien).",
    });
  }
  throw new Error(`La recherche ${opts.operation} n'a pas abouti`);
}
