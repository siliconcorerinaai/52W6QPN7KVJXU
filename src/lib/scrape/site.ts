import * as cheerio from "cheerio";
import { assertPublicUrl } from "@/lib/net-guard";
import { normalizeDomain, truncate, uniq } from "@/lib/util";

export type SitePage = { url: string; title: string; text: string };
export type SiteDigest = {
  url: string;
  domain: string;
  title: string;
  description: string;
  language: string | null;
  pages: SitePage[];
  emails: string[];
  phones: string[];
  linkedinUrl: string | null;
  socials: string[];
  techStack: string[];
};

const UA =
  "Mozilla/5.0 (compatible; CibloraBot/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const MAX_BYTES = 1_500_000;

/** Pages internes intéressantes pour la qualification et la recherche de décideurs. */
const INTERESTING = [
  /about|a-propos|apropos|qui-sommes|qui-nous-sommes|notre-histoire|company|entreprise|societe|histoire/i,
  /team|equipe|notre-equipe|leadership|management|direction|fondateurs|founders|people|gouvernance/i,
  /contact|nous-contacter/i,
  /mentions-legales|legal|imprint|impressum|mentions/i,
  /careers|carrieres|jobs|recrutement|rejoignez|join-us|emplois|nous-rejoindre/i,
  /clients|customers|references|case-stud|cas-clients|temoignages/i,
];

const MAX_REDIRECTS = 5;

/**
 * Télécharge une page HTML. Les redirections sont suivies une à une et chaque étape est
 * contrôlée : jamais d'adresse interne (localhost, réseau privé, métadonnées du cloud).
 */
export async function fetchHtml(url: string, timeoutMs = 12_000): Promise<{ html: string; finalUrl: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(current);
      res = await fetch(current, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "fr,en;q=0.8" },
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) break;
      await res.body?.cancel().catch(() => {});
      current = new URL(location, current).href;
      res = null;
    }
    if (!res || !res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    return { html, finalUrl: current };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|^(example|email|name|prenom|nom|user|your)@|sentry|wixpress|@example\.|@domain\./i;

/** Extrait les emails, y compris les formes obfusquées ("jean [at] acme [dot] fr"). */
export function extractEmails(text: string): string[] {
  const deobf = text
    .replace(/\s*[[(]\s*(?:at|arobase|@)\s*[\])]\s*/gi, "@")
    .replace(/\s+(?:at|arobase)\s+/gi, "@")
    .replace(/\s*[[(]\s*(?:dot|point)\s*[\])]\s*/gi, ".");
  const found = deobf.match(EMAIL_RE) ?? [];
  return uniq(found.map((e) => e.toLowerCase().replace(/^mailto:/, "")).filter((e) => !BAD_EMAIL.test(e)));
}

const PHONE_RE = /(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}|\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}/g;

const TECH_SIGNATURES: [string, RegExp][] = [
  ["WordPress", /wp-content|wp-includes/i],
  ["WooCommerce", /woocommerce/i],
  ["Shopify", /cdn\.shopify\.com|shopify\.theme/i],
  ["PrestaShop", /prestashop/i],
  ["Magento", /mage\/|magento/i],
  ["Wix", /wixstatic|_wixcss|wix\.com/i],
  ["Webflow", /webflow/i],
  ["Squarespace", /squarespace/i],
  ["Next.js", /__NEXT_DATA__|\/_next\//],
  ["Nuxt", /__NUXT__|\/_nuxt\//],
  ["HubSpot", /js\.hs-scripts\.com|hs-analytics|hsforms/i],
  ["Salesforce Pardot", /pardot/i],
  ["Marketo", /munchkin|marketo/i],
  ["Intercom", /widget\.intercom\.io|intercomSettings/i],
  ["Drift", /js\.driftt\.com/i],
  ["Crisp", /client\.crisp\.chat/i],
  ["Zendesk", /zdassets|zendesk/i],
  ["Google Analytics", /googletagmanager|google-analytics|gtag\(/i],
  ["Matomo", /matomo|piwik/i],
  ["Hotjar", /hotjar/i],
  ["Segment", /cdn\.segment\.com/i],
  ["Stripe", /js\.stripe\.com/i],
  ["Calendly", /calendly/i],
  ["Typeform", /typeform/i],
  ["Meta Pixel", /connect\.facebook\.net|fbq\(/i],
  ["LinkedIn Insight", /snap\.licdn\.com/i],
  ["Axeptio", /axeptio/i],
  ["Didomi", /didomi/i],
  ["Brevo", /sendinblue|brevo/i],
  ["Mailchimp", /mailchimp|list-manage\.com/i],
  ["Cloudflare", /cdn-cgi\//i],
];

function detectTech(html: string): string[] {
  return TECH_SIGNATURES.filter(([, re]) => re.test(html)).map(([name]) => name);
}

export function pageText($: cheerio.CheerioAPI): string {
  $("script, style, noscript, svg, iframe, template").remove();
  const text = $("body").text() || $.root().text();
  return text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/**
 * Explore le site d'une entreprise : page d'accueil + pages clés (à propos, équipe,
 * contact, mentions légales, carrières…). Renvoie un condensé exploitable par l'IA.
 */
export async function crawlCompanySite(domainOrUrl: string, maxPages = 6): Promise<SiteDigest | null> {
  const domain = normalizeDomain(domainOrUrl);
  if (!domain) return null;
  let home: { html: string; finalUrl: string } | null = null;
  for (const url of [`https://${domain}`, `https://www.${domain}`, `http://${domain}`]) {
    home = await fetchHtml(url);
    if (home) break;
  }
  if (!home) return null;

  const base = new URL(home.finalUrl);
  const $home = cheerio.load(home.html);
  const title = $home("title").first().text().trim();
  const description =
    $home('meta[name="description"]').attr("content")?.trim() ||
    $home('meta[property="og:description"]').attr("content")?.trim() ||
    "";
  const language = $home("html").attr("lang")?.slice(0, 5) ?? null;

  const links: string[] = [];
  const socials: string[] = [];
  const mailtos: string[] = [];
  $home("a[href]").each((_, el) => {
    const href = $home(el).attr("href") ?? "";
    if (href.startsWith("mailto:")) {
      mailtos.push(href.slice(7).split("?")[0]);
      return;
    }
    try {
      const u = new URL(href, base);
      if (/linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|welcometothejungle/i.test(u.hostname)) {
        // facebook.com/profile.php?id=… : l'identifiant de la page est dans la requête
        socials.push(/profile\.php$/i.test(u.pathname) ? u.href : u.href.split("?")[0]);
      } else if (normalizeDomain(u.hostname) === normalizeDomain(base.hostname)) {
        links.push(u.origin + u.pathname);
      }
    } catch {
      /* lien invalide */
    }
  });

  const picked: string[] = [];
  for (const re of INTERESTING) {
    const match = uniq(links).find((l) => re.test(new URL(l).pathname) && !picked.includes(l));
    if (match) picked.push(match);
    if (picked.length >= maxPages - 1) break;
  }

  const pages: SitePage[] = [{ url: home.finalUrl, title, text: truncate(pageText($home), 6000) }];
  const allHtml: string[] = [home.html];
  const fetched = await Promise.all(picked.map((u) => fetchHtml(u, 10_000)));
  fetched.forEach((r, i) => {
    if (!r) return;
    allHtml.push(r.html);
    const $ = cheerio.load(r.html);
    $("a[href^='mailto:']").each((_, el) => {
      mailtos.push(($(el).attr("href") ?? "").slice(7).split("?")[0]);
    });
    pages.push({ url: picked[i], title: $("title").first().text().trim(), text: truncate(pageText($), 5000) });
  });

  const joinedText = pages.map((p) => p.text).join("\n");
  const emails = uniq([...mailtos.map((m) => m.toLowerCase().trim()), ...extractEmails(joinedText), ...extractEmails(allHtml.join(" "))])
    .filter((e) => !BAD_EMAIL.test(e) && /@/.test(e))
    .slice(0, 30);
  const phones = uniq((joinedText.match(PHONE_RE) ?? []).map((p) => p.trim())).slice(0, 5);
  const linkedinUrl = socials.find((s) => /linkedin\.com\/company/i.test(s)) ?? null;

  return {
    url: home.finalUrl,
    domain: normalizeDomain(base.hostname) ?? domain,
    title,
    description,
    language,
    pages,
    emails,
    phones,
    linkedinUrl,
    socials: uniq(socials).slice(0, 10),
    techStack: uniq(allHtml.flatMap(detectTech)),
  };
}

/** Condensé textuel du site pour les prompts. */
export function digestToPrompt(d: SiteDigest, maxChars = 14000): string {
  const parts = [
    `Site : ${d.url}`,
    d.title && `Titre : ${d.title}`,
    d.description && `Description : ${d.description}`,
    d.techStack.length ? `Technologies détectées : ${d.techStack.join(", ")}` : "",
    d.emails.length ? `Emails trouvés : ${d.emails.join(", ")}` : "",
    d.linkedinUrl ? `LinkedIn : ${d.linkedinUrl}` : "",
    ...d.pages.map((p) => `\n--- Page ${p.url} (${p.title}) ---\n${p.text}`),
  ].filter(Boolean);
  return truncate(parts.join("\n"), maxChars);
}
