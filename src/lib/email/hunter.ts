import { config } from "@/lib/config";

/** Intégration optionnelle Hunter.io (si HUNTER_API_KEY est défini). */
export async function hunterDomainPattern(domain: string): Promise<{ pattern: string | null; emails: string[] } | null> {
  if (!config.email.hunter) return null;
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${config.email.hunter}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { pattern?: string | null; emails?: { value: string }[] } };
    return { pattern: json.data?.pattern ?? null, emails: (json.data?.emails ?? []).map((e) => e.value) };
  } catch {
    return null;
  }
}

export async function hunterFindEmail(
  domain: string,
  first: string,
  last: string,
): Promise<{ email: string; score: number } | null> {
  if (!config.email.hunter || !first || !last) return null;
  try {
    const qs = new URLSearchParams({ domain, first_name: first, last_name: last, api_key: config.email.hunter });
    const res = await fetch(`https://api.hunter.io/v2/email-finder?${qs}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { email?: string | null; score?: number } };
    return json.data?.email ? { email: json.data.email, score: json.data.score ?? 50 } : null;
  } catch {
    return null;
  }
}
