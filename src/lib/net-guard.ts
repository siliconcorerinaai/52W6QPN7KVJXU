/**
 * Hôtes fournis par les clients (serveurs SMTP/IMAP, webhooks) : le serveur s'y connecte, il ne doit
 * donc jamais s'agir d'une adresse interne (localhost, réseau privé, métadonnées du cloud).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAIL_PORTS = [25, 465, 587, 2525, 143, 993];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Lève une erreur si l'hôte est interne ou ne se résout vers aucune adresse publique. */
export async function assertPublicHost(host: string): Promise<void> {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || /\.(local|localhost|internal|lan|home|corp)$/.test(h)) throw new Error(`Hôte non autorisé : ${host}`);
  if (isIP(h)) {
    if (isPrivateAddress(h)) throw new Error(`Adresse non autorisée : ${host}`);
    return;
  }
  // En tests, la résolution DNS peut être désactivée (faux serveurs sur 127.0.0.1).
  if (process.env.ALLOW_PRIVATE_HOSTS === "true") return;
  const addrs = await lookup(h, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`Hôte introuvable : ${host}`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`Hôte non autorisé : ${host}`);
}

export async function assertPublicUrl(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Seules les adresses http(s) sont acceptées.");
  if (process.env.ALLOW_PRIVATE_HOSTS === "true") return;
  await assertPublicHost(u.hostname);
}
