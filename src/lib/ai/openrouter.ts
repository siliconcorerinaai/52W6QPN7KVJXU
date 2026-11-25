/**
 * Fournisseur OpenRouter (API compatible « chat completions »).
 * Utilisé quand aucune clé Anthropic n'est configurée, ou si AI_PROVIDER=openrouter.
 *
 * - Sortie structurée : `response_format` json_schema + schéma rappelé dans le prompt,
 *   puis validation Zod (avec une relance corrective si le JSON est invalide).
 * - Recherche web : plugin `web` d'OpenRouter ; les sources viennent des annotations `url_citation`.
 */
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "@/lib/config";
import { sleep, uniq } from "@/lib/util";
import { saveUsage, type AiContext } from "./usage";
import type { Effort } from "./claude";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type ChatResponse = {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      refusal?: string | null;
      annotations?: { type: string; url_citation?: { url: string; title?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: number };
};

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function chat(body: Record<string, unknown>): Promise<ChatResponse> {
  const url = `${config.openrouter.baseUrl}/chat/completions`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openrouter.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": config.appUrl,
          "X-Title": "Ciblora",
        },
        body: JSON.stringify({ ...body, usage: { include: true } }),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      const text = await res.text();
      let json: ChatResponse;
      try {
        json = JSON.parse(text) as ChatResponse;
      } catch {
        throw new OpenRouterError(`OpenRouter ${res.status} : réponse illisible (${text.slice(0, 200)})`, res.status);
      }
      if (!res.ok || json.error) {
        const status = json.error?.code ?? res.status;
        throw new OpenRouterError(`OpenRouter ${status} : ${json.error?.message ?? text.slice(0, 300)}`, status);
      }
      return json;
    } catch (e) {
      lastError = e;
      const status = e instanceof OpenRouterError ? e.status : 0;
      // Erreurs définitives (clé, modèle inconnu, requête invalide, crédits épuisés) : inutile d'insister
      if ([400, 401, 402, 403, 404].includes(status)) throw e;
      await sleep(1000 * 2 ** attempt + Math.random() * 500);
    }
  }
  throw lastError;
}

function schemaOf(schema: z.ZodType) {
  return betaZodOutputFormat(schema).schema as Record<string, unknown>;
}

/** Extrait le premier objet JSON d'une réponse (tolère les blocs ```json et le texte autour). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* on cherche plus loin */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* on cherche plus loin */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("Aucun objet JSON dans la réponse");
}

const reasoningFor = (effort?: Effort) =>
  effort === "low" || effort === "medium" || effort === "high" ? { reasoning: { effort } } : effort ? { reasoning: { effort: "high" } } : {};

async function completeJson<S extends z.ZodType>(opts: {
  operation: string;
  ctx: AiContext;
  schema: S;
  system: string;
  prompt: string;
  fast?: boolean;
  effort?: Effort;
  web?: { maxResults: number };
}): Promise<{ data: z.infer<S>; sources: string[] }> {
  const model = opts.fast ? config.ai.fastModel : config.ai.model;
  const jsonSchema = schemaOf(opts.schema);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${opts.system}\n\nRéponds UNIQUEMENT avec un objet JSON valide conforme à ce schéma JSON, sans texte autour :\n${JSON.stringify(jsonSchema)}`,
    },
    { role: "user", content: opts.prompt },
  ];
  const sources: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const json = await chat({
      model,
      messages,
      max_tokens: 16000,
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: jsonSchema } },
      ...reasoningFor(opts.effort),
      ...(opts.web ? { plugins: [{ id: "web", max_results: opts.web.maxResults }] } : {}),
    });
    const choice = json.choices?.[0];
    await saveUsage(opts.ctx, {
      operation: opts.operation,
      model,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      webSearches: opts.web && attempt === 0 ? 1 : 0,
      costUsd: json.usage?.cost ?? 0,
    });
    for (const a of choice?.message?.annotations ?? []) {
      if (a.type === "url_citation" && a.url_citation?.url) sources.push(a.url_citation.url);
    }
    if (choice?.message?.refusal) throw new Error(`Requête refusée par le modèle (${opts.operation}) : ${choice.message.refusal}`);
    const content = choice?.message?.content ?? "";
    if (choice?.finish_reason === "length") throw new Error(`Réponse tronquée (max_tokens) pour ${opts.operation}`);

    let error: string;
    try {
      const parsed = opts.schema.safeParse(extractJson(content));
      if (parsed.success) return { data: parsed.data, sources: uniq(sources) };
      error = parsed.error.message.slice(0, 1500);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    // Relance corrective, sans refaire la recherche web
    opts = { ...opts, web: undefined };
    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: `Ta réponse n'est pas un JSON conforme au schéma (${error}). Renvoie uniquement le JSON corrigé.` });
  }
  throw new Error(`Réponse JSON invalide pour ${opts.operation}`);
}

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
  return (await completeJson(opts)).data;
}

export async function research<S extends z.ZodType>(opts: {
  operation: string;
  ctx: AiContext;
  schema: S;
  system: string;
  prompt: string;
  maxSearches?: number;
  effort?: Effort;
  fast?: boolean;
}): Promise<{ data: z.infer<S>; sources: string[] }> {
  const maxResults = Math.min(10, Math.max(3, (opts.maxSearches ?? 5) * 2));
  return completeJson({
    ...opts,
    system: `${opts.system}\n\nDes résultats de recherche web te sont fournis : appuie-toi uniquement sur eux et sur des faits vérifiables. N'invente jamais d'information.`,
    web: { maxResults },
  });
}
