/**
 * Envoi aux adresses sûres : chaque campagne choisit quelles adresses reçoivent le premier email,
 * et un coupe-circuit resserre la règle (ou met la campagne en pause) quand les rebonds montent.
 * Un taux de rebond élevé abîme la réputation de la boîte d'envoi : les emails suivants finissent en spam.
 */
import type { EmailStatus } from "@/lib/db/schema";

export const SEND_POLICIES = ["safe", "balanced", "all"] as const;
export type SendPolicy = (typeof SEND_POLICIES)[number];
export const DEFAULT_POLICY: SendPolicy = "balanced";

/**
 * Fiabilité d'une adresse :
 * - verified : confirmée par un vérificateur, publiée par l'entreprise, saisie à la main, ou trouvée avec un score élevé ;
 * - probable : construite sur le format d'adresse confirmé de l'entreprise ;
 * - guess : devinée (format courant, non confirmé pour ce domaine) ;
 * - unusable : invalide ou absente.
 */
export type AddressTier = "verified" | "probable" | "guess" | "unusable";

export const TIER_LABEL: Record<AddressTier, string> = {
  verified: "Vérifiée",
  probable: "Format confirmé",
  guess: "Devinée",
  unusable: "Inutilisable",
};

export const POLICY_LABEL: Record<SendPolicy, { label: string; detail: string }> = {
  safe: { label: "Sûr", detail: "Seulement les adresses vérifiées ou publiées par l'entreprise." },
  balanced: { label: "Équilibré", detail: "Aussi les adresses au format confirmé de l'entreprise. Les adresses devinées sont mises de côté." },
  all: { label: "Tout", detail: "Toutes les adresses, même devinées : plus de prospects, mais plus de rebonds." },
};

type AddressFacts = {
  email: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number;
  emailSource: string | null;
};

const TRUSTED_SOURCES = new Set(["published", "manual", "verified", "smtp"]);

/**
 * `atSend` : on juge l'adresse telle qu'elle était à l'envoi (un rebond la marque ensuite « invalide »,
 * ce qui ne doit pas changer sa catégorie dans le calcul du taux de rebond).
 */
export function addressTier(a: AddressFacts, { atSend = false } = {}): AddressTier {
  if (!a.email) return "unusable";
  if (!atSend && (a.emailStatus === "invalid" || a.emailStatus === "not_found")) return "unusable";
  if (a.emailStatus === "valid") return "verified";
  if (a.emailSource && TRUSTED_SOURCES.has(a.emailSource)) return "verified";
  if (a.emailConfidence >= 80) return "verified";
  if (a.emailConfidence >= 70) return "probable";
  return "guess";
}

export function policyOf(settings: { sendPolicy?: SendPolicy }): SendPolicy {
  return settings.sendPolicy ?? DEFAULT_POLICY;
}

export function policyAllows(policy: SendPolicy, tier: AddressTier): boolean {
  if (tier === "unusable") return false;
  if (policy === "all") return true;
  if (policy === "balanced") return tier !== "guess";
  return tier === "verified";
}

/** La règle juste plus stricte (null : déjà la plus stricte). */
export function stricter(policy: SendPolicy): SendPolicy | null {
  return policy === "all" ? "balanced" : policy === "balanced" ? "safe" : null;
}

/** Seuils du coupe-circuit : au moins 10 premiers emails et 2 rebonds, et plus de 5 % de rebonds. */
export const BREAKER = { minSends: 10, minBounces: 2, maxRate: 0.05 };

export type BounceHealth = { attempts: number; bounces: number; rate: number };

export function breakerTripped(h: BounceHealth): boolean {
  return h.attempts >= BREAKER.minSends && h.bounces >= BREAKER.minBounces && h.rate > BREAKER.maxRate;
}

export const pct = (rate: number) => `${Math.round(rate * 1000) / 10} %`;
