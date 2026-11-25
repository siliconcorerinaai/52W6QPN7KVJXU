/**
 * Valide la couche Claude (sorties structurées + agent de recherche web) contre
 * un faux serveur d'API qui rejoue des flux SSE : aucun appel réel, aucun coût.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

type Block = Record<string, unknown>;
type Scripted = { content: Block[]; stop_reason: string; web_searches?: number };

const requests: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
const script: Scripted[] = [];
let server: http.Server;

function sse(res: http.ServerResponse, msg: Scripted) {
  const send = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  res.writeHead(200, { "content-type": "text/event-stream" });
  send("message_start", {
    message: { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } },
  });
  msg.content.forEach((block, index) => {
    if (block.type === "text") {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    } else if (block.type === "tool_use" || block.type === "server_tool_use") {
      send("content_block_start", { index, content_block: { ...block, input: {} } });
      send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    } else {
      send("content_block_start", { index, content_block: block });
    }
    send("content_block_stop", { index });
  });
  send("message_delta", {
    delta: { stop_reason: msg.stop_reason, stop_sequence: null },
    usage: { output_tokens: 500, server_tool_use: { web_search_requests: msg.web_searches ?? 0, web_fetch_requests: 0 } },
  });
  send("message_stop", {});
  res.end();
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw) });
      const next = script.shift();
      if (!next) {
        res.writeHead(500).end(JSON.stringify({ type: "error", error: { type: "api_error", message: "script vide" } }));
        return;
      }
      sse(res, next);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  process.env.AI_MODEL = "claude-opus-5-5";
  delete process.env.DEMO_MODE;
});

afterAll(() => server?.close());

describe("structured()", () => {
  it("envoie le schéma JSON, active le repli serveur et valide la réponse", async () => {
    const { structured } = await import("@/lib/ai/claude");
    const { getDb } = await import("@/lib/db");
    const { aiUsage } = await import("@/lib/db/schema");
    script.push({ content: [{ type: "text", text: JSON.stringify({ name: "Acme", score: 87 }) }], stop_reason: "end_turn" });

    const out = await structured({
      operation: "test",
      ctx: {},
      schema: z.object({ name: z.string(), score: z.number().int() }),
      system: "sys",
      prompt: "hello",
    });
    expect(out).toEqual({ name: "Acme", score: 87 });

    const req = requests.at(-1)!;
    expect(req.body.model).toBe("claude-opus-5-5");
    expect(req.body.fallbacks).toBe("default");
    expect(String(req.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    const oc = req.body.output_config as { format: { type: string }; effort: string };
    expect(oc.format.type).toBe("json_schema");
    expect(oc.effort).toBe("medium");

    const db = await getDb();
    const usage = await db.select().from(aiUsage);
    expect(usage.at(-1)?.operation).toBe("test");
    expect(usage.at(-1)?.costUsd).toBeGreaterThan(0);
  });
});

describe("research()", () => {
  it("reprend après pause_turn, collecte les sources et lit submit_results", async () => {
    const { research } = await import("@/lib/ai/claude");
    script.push({
      content: [
        { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "agences shopify lyon" } },
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_1",
          content: [{ type: "web_search_result", url: "https://annuaire.example/shopify", title: "Annuaire", encrypted_content: "x", page_age: null }],
        },
      ],
      stop_reason: "pause_turn",
      web_searches: 1,
    });
    script.push({
      content: [
        { type: "text", text: "J'ai trouvé deux agences." },
        { type: "tool_use", id: "toolu_1", name: "submit_results", input: { companies: [{ name: "Acme", domain: "acme.fr" }] } },
      ],
      stop_reason: "tool_use",
    });

    const res = await research({
      operation: "discover.test",
      ctx: {},
      schema: z.object({ companies: z.array(z.object({ name: z.string(), domain: z.string() })) }),
      system: "sys",
      prompt: "trouve",
    });
    expect(res.data.companies).toEqual([{ name: "Acme", domain: "acme.fr" }]);
    expect(res.sources).toContain("https://annuaire.example/shopify");

    const [first, second] = requests.slice(-2);
    const tools = first.body.tools as { type?: string; name: string; strict?: boolean }[];
    expect(tools.find((t) => t.name === "web_search")?.type).toBe("web_search_20260209");
    expect(tools.find((t) => t.name === "submit_results")?.strict).toBe(true);
    // Après pause_turn, le contenu de l'assistant est renvoyé tel quel pour que le serveur continue
    const msgs = second.body.messages as { role: string }[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("renvoie une erreur d'outil si l'entrée soumise est invalide, puis accepte la correction", async () => {
    const { research } = await import("@/lib/ai/claude");
    script.push({ content: [{ type: "tool_use", id: "toolu_a", name: "submit_results", input: { companies: "oops" } }], stop_reason: "tool_use" });
    script.push({ content: [{ type: "tool_use", id: "toolu_b", name: "submit_results", input: { companies: [] } }], stop_reason: "tool_use" });
    const res = await research({
      operation: "discover.retry",
      ctx: {},
      schema: z.object({ companies: z.array(z.object({ name: z.string() })) }),
      system: "sys",
      prompt: "trouve",
    });
    expect(res.data.companies).toEqual([]);
    const last = requests.at(-1)!.body.messages as { role: string; content: { type: string; is_error?: boolean }[] | string }[];
    const toolResult = last.at(-1)!.content as { type: string; is_error?: boolean }[];
    expect(toolResult[0]).toMatchObject({ type: "tool_result", is_error: true });
  });
});
