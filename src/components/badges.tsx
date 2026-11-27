import { Badge, type Tone } from "./ui";

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <Badge tone="slate">—</Badge>;
  const tone: Tone = score >= 80 ? "green" : score >= 60 ? "brand" : score >= 40 ? "amber" : "red";
  return (
    <Badge tone={tone} title="Adéquation au profil client idéal">
      {score}
    </Badge>
  );
}

const EMAIL: Record<string, { label: string; tone: Tone; title: string }> = {
  valid: { label: "Vérifié", tone: "green", title: "Boîte confirmée" },
  risky: { label: "Probable", tone: "amber", title: "Domaine joignable, adresse déduite non confirmée" },
  catch_all: { label: "Catch-all", tone: "violet", title: "Le domaine accepte toutes les adresses" },
  invalid: { label: "Invalide", tone: "red", title: "Adresse refusée" },
  not_found: { label: "Introuvable", tone: "slate", title: "Aucune adresse trouvée" },
  unknown: { label: "En cours", tone: "slate", title: "Recherche en cours" },
};

/** Adresse construite sur un format courant, pas encore confirmé pour ce domaine (voir lib/outreach/safety). */
const GUESSED = { label: "Devinée", tone: "amber" as Tone, title: "Format d'adresse courant, non confirmé pour cette entreprise" };

export function EmailBadge({ status, confidence }: { status: string; confidence?: number }) {
  const s = status === "risky" && confidence != null && confidence > 0 && confidence < 70 ? GUESSED : (EMAIL[status] ?? EMAIL.unknown);
  return (
    <Badge tone={s.tone} title={s.title}>
      {s.label}
      {confidence != null && confidence > 0 && <span className="opacity-60">{confidence}%</span>}
    </Badge>
  );
}

const CONTACT: Record<string, { label: string; tone: Tone }> = {
  new: { label: "Nouveau", tone: "slate" },
  searching_email: { label: "Recherche email", tone: "blue" },
  ready: { label: "Prêt", tone: "brand" },
  no_email: { label: "Sans email", tone: "slate" },
  drafted: { label: "Brouillon", tone: "amber" },
  approved: { label: "Planifié", tone: "blue" },
  sent: { label: "Contacté", tone: "violet" },
  replied: { label: "A répondu", tone: "green" },
  bounced: { label: "Rebond", tone: "red" },
  unsubscribed: { label: "Désinscrit", tone: "red" },
};

export function ContactStatusBadge({ status }: { status: string }) {
  const s = CONTACT[status] ?? CONTACT.new;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const CAMPAIGN: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Brouillon", tone: "slate" },
  running: { label: "En cours", tone: "brand" },
  paused: { label: "En pause", tone: "amber" },
  completed: { label: "Terminée", tone: "green" },
  failed: { label: "Échec", tone: "red" },
};

export function CampaignStatusBadge({ status }: { status: string }) {
  const s = CAMPAIGN[status] ?? CAMPAIGN.draft;
  return (
    <Badge tone={s.tone}>
      {status === "running" && <span className="pulse-dot size-1.5 rounded-full bg-brand-600" />}
      {s.label}
    </Badge>
  );
}

const COMPANY: Record<string, { label: string; tone: Tone }> = {
  discovered: { label: "En file", tone: "slate" },
  researching: { label: "Analyse…", tone: "blue" },
  qualified: { label: "Qualifiée", tone: "green" },
  disqualified: { label: "Écartée", tone: "slate" },
  failed: { label: "Échec", tone: "red" },
};

export function CompanyStatusBadge({ status }: { status: string }) {
  const s = COMPANY[status] ?? COMPANY.discovered;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const SIGNAL_ICON: Record<string, string> = {
  hiring: "👥",
  funding: "💰",
  growth: "📈",
  news: "📰",
  tech: "🧩",
  event: "📅",
  other: "✨",
};
export const signalIcon = (t: string) => SIGNAL_ICON[t] ?? "✨";
