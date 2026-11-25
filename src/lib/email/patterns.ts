import { slugifyName, splitName } from "@/lib/util";

export type PatternId =
  | "first.last"
  | "first"
  | "flast"
  | "firstlast"
  | "f.last"
  | "first_last"
  | "first-last"
  | "last"
  | "firstl"
  | "last.first"
  | "lastf"
  | "first.l";

/** Motifs d'email, triés par fréquence observée dans les entreprises B2B. */
export const PATTERNS: { id: PatternId; prior: number; build: (f: string, l: string) => string | null }[] = [
  { id: "first.last", prior: 0.42, build: (f, l) => (f && l ? `${f}.${l}` : null) },
  { id: "first", prior: 0.16, build: (f) => f || null },
  { id: "flast", prior: 0.12, build: (f, l) => (f && l ? `${f[0]}${l}` : null) },
  { id: "firstlast", prior: 0.07, build: (f, l) => (f && l ? `${f}${l}` : null) },
  { id: "f.last", prior: 0.06, build: (f, l) => (f && l ? `${f[0]}.${l}` : null) },
  { id: "first_last", prior: 0.03, build: (f, l) => (f && l ? `${f}_${l}` : null) },
  { id: "first-last", prior: 0.03, build: (f, l) => (f && l ? `${f}-${l}` : null) },
  { id: "last", prior: 0.03, build: (_f, l) => l || null },
  { id: "firstl", prior: 0.03, build: (f, l) => (f && l ? `${f}${l[0]}` : null) },
  { id: "last.first", prior: 0.02, build: (f, l) => (f && l ? `${l}.${f}` : null) },
  { id: "lastf", prior: 0.02, build: (f, l) => (f && l ? `${l}${f[0]}` : null) },
  { id: "first.l", prior: 0.01, build: (f, l) => (f && l ? `${f}.${l[0]}` : null) },
];

const ROLE_LOCALPARTS =
  /^(contact|info|infos|hello|bonjour|hi|sales|vente|ventes|commercial|support|help|admin|office|accueil|rh|hr|jobs|job|recrutement|careers|career|team|equipe|press|presse|media|marketing|compta|comptabilite|billing|facturation|invoice|noreply|no-reply|webmaster|postmaster|dpo|privacy|rgpd|legal|direction|secretariat|service|serviceclient|client|clients|partenariat|partners|partner)$/i;

export function isRoleEmail(email: string): boolean {
  return ROLE_LOCALPARTS.test(email.split("@")[0] ?? "");
}

export function nameParts(fullName: string, first?: string | null, last?: string | null) {
  const s = splitName(fullName);
  const f = slugifyName(first || s.first);
  // Nom composé : on garde le nom complet sans espaces ("de la tour" → "delatour")
  const l = slugifyName(last || s.last);
  return { f, l };
}

export function buildEmail(pattern: PatternId, fullName: string, domain: string, first?: string | null, last?: string | null) {
  const { f, l } = nameParts(fullName, first, last);
  const p = PATTERNS.find((x) => x.id === pattern);
  const local = p?.build(f, l);
  return local ? `${local}@${domain}` : null;
}

/**
 * Déduit le motif d'email d'une entreprise à partir d'adresses connues
 * et des noms des personnes repérées (site, mentions légales, recherche web).
 */
export function inferPattern(
  knownEmails: string[],
  people: { name: string }[],
  domain: string,
): { pattern: PatternId; evidence: string } | null {
  const personal = knownEmails
    .map((e) => e.toLowerCase())
    .filter((e) => e.endsWith(`@${domain}`) && !isRoleEmail(e));
  if (!personal.length) return null;

  // 1. Correspondance exacte avec une personne connue
  for (const email of personal) {
    const local = email.split("@")[0];
    for (const person of people) {
      const { f, l } = nameParts(person.name);
      if (!f) continue;
      for (const p of PATTERNS) {
        if (p.build(f, l) === local) return { pattern: p.id, evidence: `${email} ↔ ${person.name}` };
      }
    }
  }
  // 2. Heuristique sur la forme de l'adresse
  for (const email of personal) {
    const local = email.split("@")[0];
    if (/^[a-z]{2,}\.[a-z]{2,}$/.test(local)) return { pattern: "first.last", evidence: email };
    if (/^[a-z]\.[a-z]{2,}$/.test(local)) return { pattern: "f.last", evidence: email };
    if (/^[a-z]{2,}_[a-z]{2,}$/.test(local)) return { pattern: "first_last", evidence: email };
    if (/^[a-z]{2,}-[a-z]{2,}$/.test(local)) return { pattern: "first-last", evidence: email };
  }
  return null;
}

/** Adresses candidates, de la plus à la moins probable. */
export function candidateEmails(
  fullName: string,
  domain: string,
  knownPattern?: PatternId | null,
  first?: string | null,
  last?: string | null,
): string[] {
  const { f, l } = nameParts(fullName, first, last);
  const ordered = knownPattern
    ? [PATTERNS.find((p) => p.id === knownPattern)!, ...PATTERNS.filter((p) => p.id !== knownPattern)]
    : PATTERNS;
  const out: string[] = [];
  for (const p of ordered) {
    const local = p.build(f, l);
    if (local && !out.includes(`${local}@${domain}`)) out.push(`${local}@${domain}`);
  }
  return out;
}

/** Convertit un motif Hunter ("{first}.{last}") en PatternId. */
export function fromHunterPattern(p: string | null | undefined): PatternId | null {
  if (!p) return null;
  const map: Record<string, PatternId> = {
    "{first}.{last}": "first.last",
    "{first}": "first",
    "{f}{last}": "flast",
    "{first}{last}": "firstlast",
    "{f}.{last}": "f.last",
    "{first}_{last}": "first_last",
    "{first}-{last}": "first-last",
    "{last}": "last",
    "{first}{l}": "firstl",
    "{last}.{first}": "last.first",
    "{last}{f}": "lastf",
    "{first}.{l}": "first.l",
  };
  return map[p] ?? null;
}
