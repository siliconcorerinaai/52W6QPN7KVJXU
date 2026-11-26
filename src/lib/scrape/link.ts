import * as cheerio from "cheerio";
import { fetchHtml, pageText } from "./site";
import { isNonCompanyDomain, normalizeDomain, truncate, uniq } from "@/lib/util";

/** Lien sortant d'une page : souvent le site d'une entreprise listée (annuaire, exposants, membres…). */
export type PageLink = { domain: string; url: string; text: string };

export type LinkPage = {
  url: string;
  domain: string;
  title: string;
  description: string;
  language: string | null;
  text: string;
  links: PageLink[];
};

const MAX_LINKS = 400;

/** Normalise une saisie utilisateur en URL http(s) : « acme.fr/annuaire » → « https://acme.fr/annuaire ». */
export function normalizeUserUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!normalizeDomain(u.hostname)) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** Extrait le texte et les liens sortants d'une page HTML déjà téléchargée. */
export function parseLinkPage(html: string, pageUrl: string): LinkPage {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const ownDomain = normalizeDomain(base.hostname) ?? base.hostname;
  const title = $("title").first().text().trim();
  const description =
    $('meta[name="description"]').attr("content")?.trim() || $('meta[property="og:description"]').attr("content")?.trim() || "";
  const language = $("html").attr("lang")?.slice(0, 5) ?? null;

  const byDomain = new Map<string, PageLink>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return;
    const domain = normalizeDomain(u.hostname);
    if (!domain || domain === ownDomain || domain.endsWith(`.${ownDomain}`) || isNonCompanyDomain(domain)) return;
    const text = $(el).text().replace(/\s+/g, " ").trim() || $(el).attr("title")?.trim() || $(el).find("img").attr("alt")?.trim() || "";
    const prev = byDomain.get(domain);
    if (!prev) byDomain.set(domain, { domain, url: u.origin + u.pathname, text: truncate(text, 80) });
    else if (!prev.text && text) prev.text = truncate(text, 80);
  });

  return {
    url: pageUrl,
    domain: ownDomain,
    title,
    description,
    language,
    text: truncate(pageText($), 24_000),
    links: [...byDomain.values()].slice(0, MAX_LINKS),
  };
}

/** Lit une page fournie par l'utilisateur (liste d'entreprises, annuaire…). Null si elle est illisible. */
export async function readLinkPage(url: string): Promise<LinkPage | null> {
  const res = await fetchHtml(url, 20_000);
  if (!res) return null;
  return parseLinkPage(res.html, res.finalUrl);
}

/** Condensé de la page pour les prompts : texte + liens sortants (domaine — libellé). */
export function linkPageToPrompt(page: LinkPage, maxChars = 30_000): string {
  const links = uniq(page.links, (l) => l.domain)
    .map((l) => `- ${l.domain}${l.text ? ` — ${l.text}` : ""}`)
    .join("\n");
  return truncate(
    [
      `Page : ${page.url}`,
      page.title && `Titre : ${page.title}`,
      page.description && `Description : ${page.description}`,
      links && `\nLiens vers d'autres sites (souvent les sites des entreprises listées) :\n${links}`,
      `\nTexte de la page :\n${page.text}`,
    ]
      .filter(Boolean)
      .join("\n"),
    maxChars,
  );
}
