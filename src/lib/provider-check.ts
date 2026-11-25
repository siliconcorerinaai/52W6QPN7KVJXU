/**
 * Test des clés d'API configurées : un appel léger par service. Il est gratuit quand le service
 * le permet (comptes, crédits, liste des modèles…) ; les moteurs de recherche consomment 1 requête.
 * Les clés ne sont jamais renvoyées.
 */
import { config } from "@/lib/config";
import { errorMessage } from "@/lib/util";

export type KeyCheck = { id: string; ok: boolean; detail: string };

type Json = Record<string, unknown>;
type Reply = { status: number; json: Json | null };

const base = (envKey: string, fallback: string) => (process.env[envKey]?.trim() || fallback).replace(/\/$/, "");
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const fr = (n: number) => n.toLocaleString("fr-FR");

/** Échec attendu (clé refusée, crédits épuisés…) : le message est affiché tel quel. */
class CheckFailure extends Error {}

async function call(url: string, init: RequestInit = {}): Promise<Reply> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(text) as Json;
  } catch {
    /* réponse non JSON */
  }
  return { status: res.status, json };
}

/** Message d'un service (formats variés) pour compléter le diagnostic. */
function serviceMessage(json: Json | null): string | undefined {
  if (!json) return undefined;
  const msg = str(json.message) ?? str(json.error) ?? str(obj(json.error).message) ?? str(json.detail);
  return msg?.slice(0, 160);
}

function httpFailure(r: Reply): CheckFailure {
  const reason =
    r.status === 401 || r.status === 403
      ? "clé refusée"
      : r.status === 402
        ? "crédits épuisés ou paiement requis"
        : r.status === 429
          ? "trop de requêtes, réessayez dans quelques minutes"
          : "réponse inattendue";
  const msg = serviceMessage(r.json);
  return new CheckFailure(`${reason} (HTTP ${r.status})${msg ? ` : ${msg}` : ""}`);
}

const expectOk = (r: Reply) => {
  if (r.status < 200 || r.status >= 300) throw httpFailure(r);
  return r.json ?? {};
};

type Check = { id: string; key: () => string; run: (key: string) => Promise<string> };

const CHECKS: Check[] = [
  {
    id: "anthropic",
    key: () => process.env.ANTHROPIC_API_KEY?.trim() ?? "",
    async run(key) {
      const r = await call(`${base("ANTHROPIC_BASE_URL", "https://api.anthropic.com")}/v1/models?limit=100`, {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      });
      const json = expectOk(r);
      const model = process.env.AI_MODEL?.trim() || "claude-opus-5-5";
      const ids = Array.isArray(json.data) ? json.data.map((m) => str(obj(m).id)) : [];
      return ids.includes(model) ? `clé valide, modèle ${model} disponible` : `clé valide (le modèle ${model} n'apparaît pas dans la liste : vérifiez AI_MODEL)`;
    },
  },
  {
    id: "openrouter",
    key: () => config.openrouter.apiKey,
    async run(key) {
      const headers = { Authorization: `Bearer ${key}` };
      let r = await call(`${config.openrouter.baseUrl}/key`, { headers });
      if (r.status === 404) r = await call(`${config.openrouter.baseUrl}/auth/key`, { headers });
      const data = obj(expectOk(r).data);
      const parts: string[] = [];
      const usage = num(data.usage);
      const remaining = num(data.limit_remaining);
      if (usage !== undefined) parts.push(`${usage.toFixed(2)} $ consommés`);
      if (remaining !== undefined) parts.push(`reste ${remaining.toFixed(2)} $ sur cette clé`);
      return `clé valide${parts.length ? ` — ${parts.join(", ")}` : ""}`;
    },
  },
  {
    id: "serper",
    key: () => config.search.serper,
    async run(key) {
      const r = await call(`${base("SERPER_BASE_URL", "https://google.serper.dev")}/search`, {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: "prospecta", num: 1 }),
      });
      expectOk(r);
      return "clé valide (1 recherche consommée)";
    },
  },
  {
    id: "brave",
    key: () => config.search.brave,
    async run(key) {
      const r = await call(`${base("BRAVE_BASE_URL", "https://api.search.brave.com/res/v1")}/web/search?q=prospecta&count=1`, {
        headers: { "X-Subscription-Token": key, Accept: "application/json" },
      });
      expectOk(r);
      return "clé valide (1 recherche consommée)";
    },
  },
  {
    id: "tavily",
    key: () => config.search.tavily,
    async run(key) {
      const r = await call(`${base("TAVILY_BASE_URL", "https://api.tavily.com")}/usage`, { headers: { Authorization: `Bearer ${key}` } });
      const json = expectOk(r);
      const account = obj(json.account);
      const used = num(account.plan_usage);
      const limit = num(account.plan_limit);
      const plan = str(account.current_plan);
      const parts = [plan && `forfait ${plan}`, used !== undefined && limit !== undefined && `${fr(used)} / ${fr(limit)} crédits utilisés ce mois`].filter(Boolean);
      return `clé valide${parts.length ? ` — ${parts.join(", ")}` : ""}`;
    },
  },
  {
    id: "apollo",
    key: () => config.data.apollo,
    async run(key) {
      // Recherche de personnes : ne consomme pas de crédit, mais exige une clé « master » sur certains comptes.
      const r = await call(`${base("APOLLO_BASE_URL", "https://api.apollo.io/api/v1")}/mixed_people/api_search`, {
        method: "POST",
        headers: { "X-Api-Key": key, "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({ q_organization_domains_list: ["apollo.io"], per_page: 1, page: 1 }),
      });
      if (r.status === 403) {
        const msg = serviceMessage(r.json);
        throw new CheckFailure(
          `clé reconnue, mais la recherche de décideurs est refusée : créez une clé « master » dans Apollo (Settings → Integrations → API) ou vérifiez que votre forfait inclut l'API${msg ? ` (${msg})` : ""}`,
        );
      }
      expectOk(r);
      return "clé valide, recherche de décideurs autorisée";
    },
  },
  {
    id: "pdl",
    key: () => config.data.pdl,
    async run(key) {
      // Autocomplete : gratuit (limité en débit seulement).
      const r = await call(`${base("PDL_BASE_URL", "https://api.peopledatalabs.com/v5")}/autocomplete?field=company&text=goo&size=1`, {
        headers: { "X-Api-Key": key },
      });
      expectOk(r);
      return "clé valide";
    },
  },
  {
    id: "hunter",
    key: () => config.email.hunter,
    async run(key) {
      const r = await call(`${base("HUNTER_BASE_URL", "https://api.hunter.io/v2")}/account?api_key=${encodeURIComponent(key)}`);
      const data = obj(expectOk(r).data);
      const searches = obj(obj(data.requests).searches);
      const used = num(searches.used);
      const available = num(searches.available);
      const plan = str(data.plan_name);
      const parts = [plan && `forfait ${plan}`, used !== undefined && available !== undefined && `${fr(used)} / ${fr(available)} recherches utilisées`].filter(Boolean);
      if (available !== undefined && used !== undefined && used >= available) throw new CheckFailure(`clé valide mais quota de recherches épuisé (${parts.join(", ")})`);
      return `clé valide${parts.length ? ` — ${parts.join(", ")}` : ""}`;
    },
  },
  {
    id: "zerobounce",
    key: () => config.email.zerobounce,
    async run(key) {
      const r = await call(`${base("ZEROBOUNCE_BASE_URL", "https://api.zerobounce.net/v2")}/getcredits?api_key=${encodeURIComponent(key)}`);
      const json = expectOk(r);
      const credits = num(json.Credits ?? json.credits);
      if (credits === undefined) throw new CheckFailure(`réponse inattendue${serviceMessage(json) ? ` : ${serviceMessage(json)}` : ""}`);
      if (credits < 0) throw new CheckFailure("clé refusée");
      if (credits === 0) throw new CheckFailure("clé valide mais aucun crédit restant");
      return `clé valide — ${fr(credits)} crédits`;
    },
  },
  {
    id: "neverbounce",
    key: () => config.email.neverbounce,
    async run(key) {
      const r = await call(`${base("NEVERBOUNCE_BASE_URL", "https://api.neverbounce.com/v4")}/account/info?key=${encodeURIComponent(key)}`);
      const json = expectOk(r);
      if (json.status !== "success") throw new CheckFailure(`clé refusée${serviceMessage(json) ? ` : ${serviceMessage(json)}` : ""}`);
      const info = obj(json.credits_info);
      if ("monthly_api_usage" in info) return "clé valide — facturation mensuelle à l'usage";
      const credits = (num(info.paid_credits_remaining) ?? 0) + (num(info.free_credits_remaining) ?? 0);
      if (credits <= 0) throw new CheckFailure("clé valide mais aucun crédit restant");
      return `clé valide — ${fr(credits)} crédits`;
    },
  },
  {
    id: "millionverifier",
    key: () => config.email.millionverifier,
    async run(key) {
      const r = await call(`${base("MILLIONVERIFIER_BASE_URL", "https://api.millionverifier.com/api/v3")}/credits?api=${encodeURIComponent(key)}`);
      const json = expectOk(r);
      if (str(json.error)) throw new CheckFailure(`clé refusée : ${str(json.error)}`);
      const credits = num(json.credits);
      if (credits === undefined) throw new CheckFailure("réponse inattendue");
      if (credits <= 0) throw new CheckFailure("clé valide mais aucun crédit restant");
      return `clé valide — ${fr(credits)} crédits`;
    },
  },
];

/** Teste en parallèle chaque service dont la clé est renseignée. */
export async function checkProviderKeys(): Promise<KeyCheck[]> {
  const active = CHECKS.filter((c) => c.key());
  return Promise.all(
    active.map(async (c): Promise<KeyCheck> => {
      try {
        return { id: c.id, ok: true, detail: await c.run(c.key()) };
      } catch (e) {
        if (e instanceof CheckFailure) return { id: c.id, ok: false, detail: e.message };
        const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        return { id: c.id, ok: false, detail: timeout ? "pas de réponse en 15 s" : `service injoignable : ${errorMessage(e)}` };
      }
    }),
  );
}
