/**
 * Réseaux sociaux des entreprises prospectées : repérer leur page Facebook (et Instagram) parmi les liens
 * de leur site, et construire le lien Messenger qui ouvre directement la conversation avec la page.
 * Rien n'est automatisé sur Facebook : l'utilisateur envoie lui-même chaque message.
 */

/** Chemins Facebook qui ne sont pas une page d'entreprise (partage, connexion, aide…). */
const FB_RESERVED = new Set([
  "sharer", "sharer.php", "share", "share.php", "plugins", "dialog", "tr", "policies", "policy.php", "help", "login",
  "login.php", "privacy", "legal", "terms", "groups", "events", "watch", "hashtag", "photo.php", "photo", "story.php",
  "permalink.php", "ads", "business", "marketplace", "gaming", "home.php", "l.php", "settings", "notes", "media",
  "video.php", "reel", "reels", "stories", "people", "search", "profile.php", "pages", "pg", "public", "about",
]);

const FB_HOST = /^(?:www\.|m\.|web\.|business\.|fr-fr\.|en-gb\.|[a-z]{2}-[a-z]{2}\.)?(?:facebook\.com|fb\.com|fb\.me)$/i;
const IG_HOST = /^(?:www\.)?instagram\.com$/i;

function parse(input: string): URL | null {
  const s = input.trim();
  if (!s) return null;
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

/** Adresse canonique d'une page Facebook (https://www.facebook.com/<page>), ou null si ce n'en est pas une. */
export function normalizeFacebookUrl(input: string): string | null {
  const u = parse(input);
  if (!u || !FB_HOST.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  // Profil ou page sans nom d'utilisateur : facebook.com/profile.php?id=123
  if (parts[0]?.toLowerCase() === "profile.php") {
    const id = u.searchParams.get("id");
    return id && /^\d{5,25}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  // Ancien format : facebook.com/pages/Nom/123456
  if (parts[0]?.toLowerCase() === "pages" && parts.length >= 3 && /^\d{5,25}$/.test(parts[2])) {
    return `https://www.facebook.com/${parts[2]}`;
  }
  // facebook.com/p/Nom-123456 (nouvelles pages)
  if (parts[0]?.toLowerCase() === "p" && parts[1]) {
    const id = parts[1].match(/(\d{5,25})$/)?.[1];
    return id ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  const slug = parts[0];
  if (!slug || FB_RESERVED.has(slug.toLowerCase()) || !/^[\w.-]{2,80}$/.test(slug)) return null;
  return `https://www.facebook.com/${slug}`;
}

/** Première page Facebook trouvée parmi des liens (ceux d'un site, par exemple). */
export function facebookPageFrom(urls: string[]): string | null {
  for (const url of urls) {
    const page = normalizeFacebookUrl(url);
    if (page) return page;
  }
  return null;
}

/** Premier compte Instagram trouvé parmi des liens. */
export function instagramFrom(urls: string[]): string | null {
  for (const url of urls) {
    const u = parse(url);
    if (!u || !IG_HOST.test(u.hostname)) continue;
    const handle = u.pathname.split("/").filter(Boolean)[0];
    if (handle && /^[\w.]{2,30}$/.test(handle) && !["p", "reel", "reels", "explore", "accounts", "stories", "tv", "direct"].includes(handle.toLowerCase())) {
      return `https://www.instagram.com/${handle}`;
    }
  }
  return null;
}

/** Lien qui ouvre la conversation Messenger avec la page (m.me/<page> ou m.me/<id>). */
export function messengerUrl(facebookUrl: string | null | undefined): string | null {
  const page = facebookUrl ? normalizeFacebookUrl(facebookUrl) : null;
  if (!page) return null;
  const u = new URL(page);
  const id = u.searchParams.get("id");
  const target = id ?? u.pathname.split("/").filter(Boolean)[0];
  return target ? `https://m.me/${target}` : null;
}

/** Messages envoyés à la main par jour au-delà desquels Facebook commence à restreindre un compte. */
export const FACEBOOK_DAILY_ADVICE = 20;
