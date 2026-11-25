/**
 * Vérification d'emails par des services spécialisés (optionnels, cumulables) :
 * ZeroBounce, NeverBounce, MillionVerifier. Ils testent les boîtes depuis des IP réputées,
 * ce qu'un hébergeur cloud (port 25 bloqué) ne permet pas.
 * Les fournisseurs configurés sont interrogés dans l'ordre jusqu'à une réponse définitive
 * (valide ou invalide) ; « catch-all » et « inconnu » passent au suivant.
 */
import { config } from "@/lib/config";
import type { EmailStatus } from "@/lib/db/schema";

export type ProviderVerdict = { provider: string; status: EmailStatus; detail: string };

type Verifier = { name: string; enabled: () => boolean; check: (email: string) => Promise<ProviderVerdict | null> };

const base = (envKey: string, fallback: string) => (process.env[envKey]?.trim() || fallback).replace(/\/$/, "");

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function mapZeroBounce(status: string, sub: string): EmailStatus {
  switch (status) {
    case "valid":
      return "valid";
    case "invalid":
    case "spamtrap":
    case "abuse":
    case "do_not_mail":
      return "invalid";
    case "catch-all":
      return "catch_all";
    default:
      return sub === "greylisted" ? "unknown" : "unknown";
  }
}

export function mapNeverBounce(result: string): EmailStatus {
  return result === "valid" ? "valid" : result === "invalid" || result === "disposable" ? "invalid" : result === "catchall" ? "catch_all" : "unknown";
}

export function mapMillionVerifier(result: string): EmailStatus {
  return result === "ok" ? "valid" : result === "invalid" || result === "disposable" ? "invalid" : result === "catch_all" ? "catch_all" : "unknown";
}

const VERIFIERS: Verifier[] = [
  {
    name: "ZeroBounce",
    enabled: () => !!config.email.zerobounce,
    async check(email) {
      const qs = new URLSearchParams({ api_key: config.email.zerobounce, email, ip_address: "" });
      const json = await getJson(`${base("ZEROBOUNCE_BASE_URL", "https://api.zerobounce.net/v2")}/validate?${qs}`);
      if (!json || typeof json.status !== "string") return null;
      const sub = String(json.sub_status ?? "");
      return { provider: "ZeroBounce", status: mapZeroBounce(json.status, sub), detail: [json.status, sub].filter(Boolean).join(" / ") };
    },
  },
  {
    name: "NeverBounce",
    enabled: () => !!config.email.neverbounce,
    async check(email) {
      const qs = new URLSearchParams({ key: config.email.neverbounce, email });
      const json = await getJson(`${base("NEVERBOUNCE_BASE_URL", "https://api.neverbounce.com/v4")}/single/check?${qs}`);
      if (!json || json.status !== "success" || typeof json.result !== "string") return null;
      return { provider: "NeverBounce", status: mapNeverBounce(json.result), detail: json.result };
    },
  },
  {
    name: "MillionVerifier",
    enabled: () => !!config.email.millionverifier,
    async check(email) {
      const qs = new URLSearchParams({ api: config.email.millionverifier, email, timeout: "20" });
      const json = await getJson(`${base("MILLIONVERIFIER_BASE_URL", "https://api.millionverifier.com/api/v3")}/?${qs}`);
      if (!json || typeof json.result !== "string" || json.result === "error") return null;
      return { provider: "MillionVerifier", status: mapMillionVerifier(json.result), detail: [json.result, json.subresult].filter(Boolean).join(" / ") };
    },
  },
];

export function verificationProviders(): string[] {
  return VERIFIERS.filter((v) => v.enabled()).map((v) => v.name);
}

/** Interroge les fournisseurs configurés ; renvoie le verdict le plus fiable obtenu (ou null si aucun). */
export async function verifyWithProviders(email: string): Promise<ProviderVerdict | null> {
  let fallback: ProviderVerdict | null = null;
  for (const v of VERIFIERS) {
    if (!v.enabled()) continue;
    const verdict = await v.check(email);
    if (!verdict) continue;
    if (verdict.status === "valid" || verdict.status === "invalid") return verdict;
    // catch-all prime sur inconnu ; on continue pour chercher un verdict définitif
    if (!fallback || (fallback.status === "unknown" && verdict.status === "catch_all")) fallback = verdict;
  }
  return fallback;
}
