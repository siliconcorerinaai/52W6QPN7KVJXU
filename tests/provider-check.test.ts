/** Test des clés d'API contre de faux serveurs HTTP : aucun appel réel. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type Req = { method: string; url: string; headers: http.IncomingHttpHeaders };
type Route = (r: Req) => { status?: number; body: unknown };
const requests: Req[] = [];
const routes = new Map<string, Route>();
let server: http.Server;

const KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "SERPER_API_KEY",
  "BRAVE_API_KEY",
  "TAVILY_API_KEY",
  "APOLLO_API_KEY",
  "PDL_API_KEY",
  "HUNTER_API_KEY",
  "ZEROBOUNCE_API_KEY",
  "NEVERBOUNCE_API_KEY",
  "MILLIONVERIFIER_API_KEY",
];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const r: Req = { method: req.method!, url: req.url!, headers: req.headers };
      requests.push(r);
      const route = routes.get(`${req.method} ${req.url!.split("?")[0]}`);
      const out = route ? route(r) : { status: 404, body: { message: "not found" } };
      res.writeHead(out.status ?? 200, { "content-type": "application/json" }).end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    ANTHROPIC_BASE_URL: `${url}/anthropic`,
    OPENROUTER_BASE_URL: `${url}/openrouter`,
    SERPER_BASE_URL: `${url}/serper`,
    BRAVE_BASE_URL: `${url}/brave`,
    TAVILY_BASE_URL: `${url}/tavily`,
    APOLLO_BASE_URL: `${url}/apollo`,
    PDL_BASE_URL: `${url}/pdl`,
    HUNTER_BASE_URL: `${url}/hunter`,
    ZEROBOUNCE_BASE_URL: `${url}/zb`,
    NEVERBOUNCE_BASE_URL: `${url}/nb`,
    MILLIONVERIFIER_BASE_URL: `${url}/mv`,
    AI_MODEL: "claude-opus-5-5",
  });
});
afterAll(() => server?.close());
beforeEach(() => {
  routes.clear();
  requests.length = 0;
  for (const k of KEYS) delete process.env[k];
});

/** Les nombres en français utilisent une espace insécable fine comme séparateur des milliers. */
const plain = (s: string) => s.replace(/\s/g, " ");

async function run() {
  const { checkProviderKeys } = await import("@/lib/provider-check");
  return Object.fromEntries((await checkProviderKeys()).map((r) => [r.id, r]));
}

describe("test des clés d'API", () => {
  it("ne teste que les services configurés", async () => {
    process.env.HUNTER_API_KEY = "h";
    routes.set("GET /hunter/account", () => ({
      body: { data: { plan_name: "Free", requests: { searches: { used: 3, available: 25 } } } },
    }));
    const res = await run();
    expect(Object.keys(res)).toEqual(["hunter"]);
    expect(res.hunter).toMatchObject({ ok: true, detail: "clé valide — forfait Free, 3 / 25 recherches utilisées" });
    expect(requests[0].url).toContain("api_key=h");
  });

  it("confirme les clés valides avec les informations utiles", async () => {
    for (const k of KEYS) process.env[k] = `cle-${k}`;
    routes.set("GET /anthropic/v1/models", (r) => {
      expect(r.headers["x-api-key"]).toBe("cle-ANTHROPIC_API_KEY");
      return { body: { data: [{ id: "claude-opus-5-5" }, { id: "claude-haiku-5-5" }] } };
    });
    routes.set("GET /openrouter/key", () => ({ body: { data: { usage: 0.065, limit_remaining: null } } }));
    routes.set("POST /serper/search", () => ({ body: { organic: [] } }));
    routes.set("GET /brave/web/search", () => ({ body: { web: { results: [] } } }));
    routes.set("GET /tavily/usage", () => ({ body: { account: { current_plan: "Researcher", plan_usage: 12, plan_limit: 1000 } } }));
    routes.set("POST /apollo/mixed_people/api_search", () => ({ body: { people: [] } }));
    routes.set("GET /pdl/autocomplete", () => ({ body: { data: [] } }));
    routes.set("GET /hunter/account", () => ({ body: { data: { requests: { searches: { used: 0, available: 25 } } } } }));
    routes.set("GET /zb/getcredits", () => ({ body: { Credits: "100" } }));
    routes.set("GET /nb/account/info", () => ({ body: { status: "success", credits_info: { paid_credits_remaining: 0, free_credits_remaining: 10 } } }));
    routes.set("GET /mv/credits", () => ({ body: { credits: 2500 } }));

    const res = await run();
    expect(Object.values(res).every((r) => r.ok)).toBe(true);
    expect(res.anthropic.detail).toBe("clé valide, modèle claude-opus-5-5 disponible");
    expect(res.openrouter.detail).toBe("clé valide — 0.07 $ consommés");
    expect(res.serper.detail).toContain("1 recherche consommée");
    expect(plain(res.tavily.detail)).toBe("clé valide — forfait Researcher, 12 / 1 000 crédits utilisés ce mois");
    expect(res.zerobounce.detail).toBe("clé valide — 100 crédits");
    expect(res.neverbounce.detail).toBe("clé valide — 10 crédits");
    expect(plain(res.millionverifier.detail)).toBe("clé valide — 2 500 crédits");
    expect(requests.find((r) => r.url.startsWith("/brave"))!.headers["x-subscription-token"]).toBe("cle-BRAVE_API_KEY");
  });

  it("explique chaque problème de clé", async () => {
    for (const k of ["ANTHROPIC_API_KEY", "SERPER_API_KEY", "APOLLO_API_KEY", "HUNTER_API_KEY", "ZEROBOUNCE_API_KEY", "NEVERBOUNCE_API_KEY", "MILLIONVERIFIER_API_KEY"])
      process.env[k] = "mauvaise";
    routes.set("GET /anthropic/v1/models", () => ({ status: 401, body: { error: { type: "authentication_error", message: "invalid x-api-key" } } }));
    routes.set("POST /serper/search", () => ({ status: 400, body: { message: "Not enough credits" } }));
    routes.set("POST /apollo/mixed_people/api_search", () => ({ status: 403, body: { error: "api/v1/mixed_people/api_search requires a master key" } }));
    routes.set("GET /hunter/account", () => ({ body: { data: { requests: { searches: { used: 25, available: 25 } } } } }));
    routes.set("GET /zb/getcredits", () => ({ body: { Credits: "-1" } }));
    routes.set("GET /nb/account/info", () => ({ body: { status: "auth_failure", message: "Invalid API key" } }));
    routes.set("GET /mv/credits", () => ({ body: { error: "Invalid API key" } }));

    const res = await run();
    expect(Object.values(res).every((r) => !r.ok)).toBe(true);
    expect(res.anthropic.detail).toBe("clé refusée (HTTP 401) : invalid x-api-key");
    expect(res.serper.detail).toBe("réponse inattendue (HTTP 400) : Not enough credits");
    expect(res.apollo.detail).toContain("créez une clé « master »");
    expect(res.hunter.detail).toContain("quota de recherches épuisé");
    expect(res.zerobounce.detail).toBe("clé refusée");
    expect(res.neverbounce.detail).toBe("clé refusée : Invalid API key");
    expect(res.millionverifier.detail).toBe("clé refusée : Invalid API key");
  });

  it("signale un service injoignable sans faire échouer les autres", async () => {
    process.env.PDL_API_KEY = "p";
    process.env.ZEROBOUNCE_API_KEY = "z";
    process.env.PDL_BASE_URL = "http://127.0.0.1:1";
    routes.set("GET /zb/getcredits", () => ({ body: { Credits: 5 } }));
    const res = await run();
    expect(res.pdl.ok).toBe(false);
    expect(res.pdl.detail).toMatch(/^service injoignable/);
    expect(res.zerobounce).toMatchObject({ ok: true, detail: "clé valide — 5 crédits" });
  });
});
