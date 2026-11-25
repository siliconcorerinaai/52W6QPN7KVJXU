import { config } from "@/lib/config";

export type SearchResult = { title: string; url: string; snippet: string };

async function serper(query: string, num: number): Promise<SearchResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": config.search.serper, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const json = (await res.json()) as { organic?: { title: string; link: string; snippet?: string }[] };
  return (json.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" }));
}

async function brave(query: string, num: number): Promise<SearchResult[]> {
  const qs = new URLSearchParams({ q: query, count: String(Math.min(num, 20)) });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${qs}`, {
    headers: { "X-Subscription-Token": config.search.brave, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const json = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
  return (json.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: (r.description ?? "").replace(/<[^>]+>/g, ""),
  }));
}

async function tavily(query: string, num: number): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.search.tavily}` },
    body: JSON.stringify({ query, max_results: Math.min(num, 20), search_depth: "basic" }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const json = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
  return (json.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
}

export function searchProviderName(): string | null {
  if (config.search.serper) return "serper";
  if (config.search.brave) return "brave";
  if (config.search.tavily) return "tavily";
  return null;
}

/** Recherche via le premier moteur configuré (Serper → Brave → Tavily). Renvoie [] si aucun. */
export async function webSearch(query: string, num = 10): Promise<SearchResult[]> {
  const provider = searchProviderName();
  try {
    if (provider === "serper") return await serper(query, num);
    if (provider === "brave") return await brave(query, num);
    if (provider === "tavily") return await tavily(query, num);
  } catch (e) {
    console.warn(`[search] ${provider} a échoué pour "${query}"`, e);
  }
  return [];
}

export function formatResults(results: SearchResult[]): string {
  return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
}
