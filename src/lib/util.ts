import { randomUUID } from "node:crypto";

export const newId = () => randomUUID();

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Délai dépassé (distinct des autres erreurs pour pouvoir réagir, ex. recréer les connexions). */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/** Rejette avec une TimeoutError si `p` n'est pas résolue en `ms` millisecondes. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`Délai dépassé (${Math.round(ms / 1000)} s) pour ${label}`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Normalise un domaine : "https://www.Acme.fr/contact" → "acme.fr". Renvoie null si invalide. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\d?\./, "");
  s = s.split(/[/?#:\s]/)[0] ?? "";
  s = s.replace(/\.+$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  if (s.length > 253) return null;
  return s;
}

/** Domaines qui ne sont jamais le site d'une entreprise cible (annuaires, réseaux, médias…). */
const NON_COMPANY_DOMAINS = [
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "tiktok.com",
  "wikipedia.org", "crunchbase.com", "glassdoor.com", "glassdoor.fr", "indeed.com", "indeed.fr",
  "welcometothejungle.com", "societe.com", "pappers.fr", "infogreffe.fr", "pagesjaunes.fr", "yelp.com",
  "google.com", "bing.com", "medium.com", "github.com", "g2.com", "capterra.com", "capterra.fr",
  "trustpilot.com", "amazon.com", "apple.com", "zoominfo.com", "apollo.io", "lusha.com", "rocketreach.co",
  "dnb.com", "kompass.com", "verif.com", "manageo.fr", "lefigaro.fr", "lesechos.fr", "bfmtv.com",
  "techcrunch.com", "forbes.com", "bloomberg.com", "reuters.com", "producthunt.com", "angel.co", "wellfound.com",
];

export function isNonCompanyDomain(domain: string): boolean {
  return NON_COMPANY_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Découpe un nom complet en prénom / nom. */
export function splitName(full: string): { first: string; last: string } {
  const cleaned = full
    .replace(/\(.*?\)/g, " ")
    .replace(/[,|·•–—-]\s.*$/, "")
    .replace(/\b(dr|mr|mrs|ms|m|mme|mlle|prof)\.?\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Retire accents et caractères non alphanumériques (pour construire des emails). */
export function slugifyName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/[^a-z0-9]/g, "");
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function uniq<T>(arr: T[], key: (x: T) => string = (x) => String(x)): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Exécute `fn` sur chaque élément avec une concurrence bornée. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Hash déterministe simple (pour le mode démo). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
