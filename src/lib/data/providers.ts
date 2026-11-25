/**
 * Bases de données B2B (optionnelles) : Apollo.io et People Data Labs.
 * Elles complètent la recherche web : plus de volume, effectifs et localisation fiables,
 * et des décideurs déjà identifiés. Clés : APOLLO_API_KEY, PDL_API_KEY.
 */
import { config } from "@/lib/config";
import { normalizeDomain, splitName, uniq } from "@/lib/util";
import type { CampaignPlan } from "@/lib/types";
import { apolloRange, employeeBuckets, pdlSize, searchKeywords, titleCase, toCountries } from "./mapping";

export type DataCompany = {
  provider: "apollo" | "pdl";
  name: string;
  domain: string;
  industry?: string;
  location?: string;
  employees?: string;
  linkedinUrl?: string;
  description?: string;
};

export type DataPerson = {
  provider: "apollo" | "pdl";
  name: string;
  title: string;
  linkedinUrl?: string;
  email?: string;
};

const base = (envKey: string, fallback: string) => (process.env[envKey]?.trim() || fallback).replace(/\/$/, "");
type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Json | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[data] ${url} → HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as Json;
  } catch (e) {
    console.warn(`[data] ${url}`, e);
    return null;
  }
}

// ───────────────────────────── Apollo.io ─────────────────────────────

async function apolloCompanies(plan: CampaignPlan, count: number, page: number): Promise<DataCompany[]> {
  const body: Json = { page, per_page: Math.min(100, Math.max(10, count)) };
  const keywords = searchKeywords(plan.keywords, plan.industries);
  if (keywords.length) body.q_organization_keyword_tags = keywords;
  const countries = toCountries(plan.geographies).map(titleCase);
  if (countries.length) body.organization_locations = countries;
  const ranges = employeeBuckets(plan.companySize).map(apolloRange);
  if (ranges.length) body.organization_num_employees_ranges = ranges;

  const json = await postJson(`${base("APOLLO_BASE_URL", "https://api.apollo.io/api/v1")}/mixed_companies/search`, { "X-Api-Key": config.data.apollo, "Cache-Control": "no-cache" }, body);
  const rows = [...((json?.organizations as Json[]) ?? []), ...((json?.accounts as Json[]) ?? [])];
  return rows
    .map((o): DataCompany | null => {
      const domain = normalizeDomain(str(o.primary_domain) ?? str(o.website_url) ?? str(o.domain));
      const name = str(o.name);
      if (!domain || !name) return null;
      return {
        provider: "apollo",
        name,
        domain,
        industry: str(o.industry),
        location: [str(o.city), str(o.country)].filter(Boolean).join(", ") || undefined,
        employees: typeof o.estimated_num_employees === "number" ? `${o.estimated_num_employees} salariés` : undefined,
        linkedinUrl: str(o.linkedin_url),
        description: str(o.short_description),
      };
    })
    .filter((x): x is DataCompany => !!x);
}

async function apolloPeople(domain: string, titles: string[], count: number): Promise<DataPerson[]> {
  const json = await postJson(
    `${base("APOLLO_BASE_URL", "https://api.apollo.io/api/v1")}/mixed_people/api_search`,
    { "X-Api-Key": config.data.apollo, "Cache-Control": "no-cache" },
    { q_organization_domains_list: [domain], person_titles: titles.slice(0, 10), page: 1, per_page: Math.min(25, Math.max(5, count)) },
  );
  return ((json?.people as Json[]) ?? [])
    .map((p): DataPerson | null => {
      const first = str(p.first_name);
      const last = str(p.last_name);
      const name = first && last ? `${first} ${last}` : str(p.name);
      const title = str(p.title);
      // Les noms masqués (« Dupont » → « D*** ») ne permettent pas de déduire l'email
      if (!name || !title || name.includes("*") || splitName(name).last.length < 2) return null;
      const email = str(p.email);
      return { provider: "apollo", name, title, linkedinUrl: str(p.linkedin_url), email: email && !email.includes("not_unlocked") ? email : undefined };
    })
    .filter((x): x is DataPerson => !!x);
}

// ───────────────────────────── People Data Labs ─────────────────────────────

async function pdlCompanies(plan: CampaignPlan, count: number): Promise<DataCompany[]> {
  const must: Json[] = [];
  const countries = toCountries(plan.geographies);
  if (countries.length) must.push({ terms: { location_country: countries } });
  const sizes = employeeBuckets(plan.companySize).map(pdlSize);
  if (sizes.length) must.push({ terms: { size: sizes } });
  const should = searchKeywords(plan.keywords, plan.industries).flatMap((k) => [
    { match: { summary: k } },
    { match: { industry: k } },
    { match: { tags: k } },
  ]);
  const query: Json = { bool: { must, ...(should.length ? { should, minimum_should_match: 1 } : {}) } };
  const json = await postJson(`${base("PDL_BASE_URL", "https://api.peopledatalabs.com/v5")}/company/search`, { "X-Api-Key": config.data.pdl }, {
    query,
    size: Math.min(100, Math.max(10, count)),
  });
  return ((json?.data as Json[]) ?? [])
    .map((c): DataCompany | null => {
      const domain = normalizeDomain(str(c.website));
      const name = str(c.display_name) ?? str(c.name);
      if (!domain || !name) return null;
      const loc = (c.location ?? {}) as Json;
      return {
        provider: "pdl",
        name: name.replace(/\b\w/g, (ch) => ch.toUpperCase()),
        domain,
        industry: str(c.industry),
        location: str(loc.name) ?? ([str(loc.locality), str(loc.country)].filter(Boolean).join(", ") || undefined),
        employees: str(c.size) ? `${str(c.size)} salariés` : undefined,
        linkedinUrl: str(c.linkedin_url) ? `https://${String(c.linkedin_url).replace(/^https?:\/\//, "")}` : undefined,
        description: str(c.summary),
      };
    })
    .filter((x): x is DataCompany => !!x);
}

async function pdlPeople(domain: string, titles: string[], count: number): Promise<DataPerson[]> {
  const query = {
    bool: {
      must: [{ term: { job_company_website: domain } }],
      should: titles.slice(0, 10).map((t) => ({ match: { job_title: t } })),
      minimum_should_match: titles.length ? 1 : 0,
    },
  };
  const json = await postJson(`${base("PDL_BASE_URL", "https://api.peopledatalabs.com/v5")}/person/search`, { "X-Api-Key": config.data.pdl }, {
    query,
    size: Math.min(25, Math.max(5, count)),
  });
  return ((json?.data as Json[]) ?? [])
    .map((p): DataPerson | null => {
      const name = str(p.full_name);
      const title = str(p.job_title);
      if (!name || !title || splitName(name).last.length < 2) return null;
      const email = str(p.work_email);
      return {
        provider: "pdl",
        name: name.replace(/\b\w/g, (ch) => ch.toUpperCase()),
        title,
        linkedinUrl: str(p.linkedin_url) ? `https://${String(p.linkedin_url).replace(/^https?:\/\//, "")}` : undefined,
        email: email && email.endsWith(`@${domain}`) ? email.toLowerCase() : undefined,
      };
    })
    .filter((x): x is DataPerson => !!x);
}

// ───────────────────────────── Façade ─────────────────────────────

export function dataProviders(): ("apollo" | "pdl")[] {
  return [...(config.data.apollo ? (["apollo"] as const) : []), ...(config.data.pdl ? (["pdl"] as const) : [])];
}

/** Entreprises correspondant au plan dans les bases configurées (sans les domaines déjà connus). */
export async function searchCompaniesInDatabases(plan: CampaignPlan, count: number, exclude: Set<string>, round: number): Promise<DataCompany[]> {
  const tasks: Promise<DataCompany[]>[] = [];
  if (config.data.apollo) tasks.push(apolloCompanies(plan, count + exclude.size, round + 1));
  if (config.data.pdl && round === 0) tasks.push(pdlCompanies(plan, count + Math.min(exclude.size, 60)));
  const all = (await Promise.all(tasks)).flat();
  return uniq(all.filter((c) => !exclude.has(c.domain)), (c) => c.domain).slice(0, count);
}

/** Décideurs d'une entreprise dans les bases configurées. */
export async function searchPeopleInDatabases(domain: string, titles: string[], count: number): Promise<DataPerson[]> {
  const tasks: Promise<DataPerson[]>[] = [];
  if (config.data.apollo) tasks.push(apolloPeople(domain, titles, count));
  if (config.data.pdl) tasks.push(pdlPeople(domain, titles, count));
  return uniq((await Promise.all(tasks)).flat(), (p) => p.name.toLowerCase());
}
