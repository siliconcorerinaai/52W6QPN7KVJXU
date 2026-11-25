/**
 * Valide l'adaptateur OpenRouter contre un faux serveur « chat completions » : aucun appel réel.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const requests: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
const script: { status?: number; body: unknown }[] = [];
let server: http.Server;

const reply = (content: string, extra: Record<string, unknown> = {}) => ({
  body: {
    id: "gen-1",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content, ...extra } }],
    usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.0123 },
  },
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw) });
      const next = script.shift() ?? { status: 500, body: { error: { message: "script vide", code: 500 } } };
      res.writeHead(next.status ?? 200, { "content-type": "application/json" }).end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${port}/api/v1`;
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.OPENROUTER_MODEL = "anthropic/claude-opus-5.5";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEMO_MODE;
});

afterAll(() => server?.close());

describe("sélection du fournisseur", () => {
  it("utilise OpenRouter sans clé Anthropic, et Anthropic en priorité sinon", async () => {
    const { config } = await import("@/lib/config");
    expect(config.ai.provider).toBe("openrouter");
    expect(config.demoMode).toBe(false);
    expect(config.ai.model).toBe("anthropic/claude-opus-5.5");
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    expect(config.ai.provider).toBe("anthropic");
    process.env.AI_PROVIDER = "openrouter";
    expect(config.ai.provider).toBe("openrouter");
    delete process.env.AI_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe("OpenRouter structured()", () => {
  it("envoie le schéma, lit un JSON entouré de texte et enregistre le coût", async () => {
    const { structured } = await import("@/lib/ai/llm");
    const { getDb } = await import("@/lib/db");
    const { aiUsage } = await import("@/lib/db/schema");
    script.push(reply('Voici :\n```json\n{"name":"Acme","score":82}\n```'));

    const out = await structured({ operation: "or.test", ctx: {}, schema: z.object({ name: z.string(), score: z.number().int() }), system: "sys", prompt: "go" });
    expect(out).toEqual({ name: "Acme", score: 82 });

    const req = requests.at(-1)!;
    expect(req.headers.authorization).toBe("Bearer sk-or-test");
    expect(req.body.model).toBe("anthropic/claude-opus-5.5");
    expect((req.body.response_format as { type: string }).type).toBe("json_schema");
    expect(req.body.plugins).toBeUndefined();
    expect(req.body.usage).toEqual({ include: true });

    const db = await getDb();
    const usage = await db.select().from(aiUsage);
    expect(usage.at(-1)).toMatchObject({ operation: "or.test", inputTokens: 1200, outputTokens: 300 });
    expect(usage.at(-1)?.costUsd).toBeCloseTo(0.0123);
  });

  it("relance une fois avec l'erreur quand le JSON ne respecte pas le schéma", async () => {
    const { structured } = await import("@/lib/ai/llm");
    script.push(reply('{"name": 42}'));
    script.push(reply('{"name": "Corrigé"}'));
    const out = await structured({ operation: "or.retry", ctx: {}, schema: z.object({ name: z.string() }), system: "sys", prompt: "go" });
    expect(out).toEqual({ name: "Corrigé" });
    const msgs = requests.at(-1)!.body.messages as { role: string; content: string }[];
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs.at(-1)!.content).toContain("JSON");
  });

  it("ne réessaie pas une erreur définitive (modèle inconnu)", async () => {
    const { structured } = await import("@/lib/ai/llm");
    const before = requests.length;
    script.push({ status: 400, body: { error: { message: "not a valid model ID", code: 400 } } });
    await expect(structured({ operation: "or.bad", ctx: {}, schema: z.object({ a: z.string() }), system: "s", prompt: "p" })).rejects.toThrow(/not a valid model ID/);
    expect(requests.length - before).toBe(1);
  });
});

describe("OpenRouter research()", () => {
  it("active le plugin web et collecte les sources citées", async () => {
    const { research } = await import("@/lib/ai/llm");
    script.push(
      reply('{"companies":[{"name":"Acme","domain":"acme.fr"}]}', {
        annotations: [
          { type: "url_citation", url_citation: { url: "https://acme.fr/a-propos", title: "Acme" } },
          { type: "url_citation", url_citation: { url: "https://acme.fr/a-propos", title: "Acme" } },
        ],
      }),
    );
    const res = await research({
      operation: "or.research",
      ctx: {},
      schema: z.object({ companies: z.array(z.object({ name: z.string(), domain: z.string() })) }),
      system: "sys",
      prompt: "trouve",
      maxSearches: 4,
    });
    expect(res.data.companies[0].domain).toBe("acme.fr");
    expect(res.sources).toEqual(["https://acme.fr/a-propos"]);
    expect(requests.at(-1)!.body.plugins).toEqual([{ id: "web", max_results: 8 }]);
  });
});
