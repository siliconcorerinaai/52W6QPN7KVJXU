import type { AiContext } from "./usage";
import type { PlanResponse, Analysis, PeopleResult, Sequence, Triage } from "./schemas";
import type { CampaignOffer, CampaignPlan, CompanyCandidate, ImportedCompany, LinkKind } from "@/lib/types";
import type { SiteDigest } from "@/lib/scrape/site";
import type { LinkPage } from "@/lib/scrape/link";
import type { Company, Contact } from "@/lib/db/schema";

export type DiscoverInput = {
  prompt: string;
  plan: CampaignPlan;
  count: number;
  exclude: string[];
  round: number;
  seeds: string[];
};

export type AnalyzeInput = {
  prompt: string;
  plan: CampaignPlan;
  offer: CampaignOffer;
  candidate: CompanyCandidate;
  digest: SiteDigest | null;
  deep: boolean;
};

export type PeopleInput = { plan: CampaignPlan; company: Company; count: number; deep: boolean };

export type WriteInput = {
  plan: CampaignPlan;
  offer: CampaignOffer;
  company: Company;
  contact: Contact;
  steps: number;
  followUpDays: number;
  /** Lien du visuel offert à l'entreprise, à citer dans le premier email. */
  sampleUrl?: string | null;
  /** La page du visuel contient aussi une courte vidéo animée (prête). */
  sampleVideo?: boolean;
};

export type VisualInput = { company: Company; offer: CampaignOffer; brief: string };

/** Un message du fil avec un prospect (nos emails et ses réponses), du plus ancien au plus récent. */
export type ThreadItem = { from: "us" | "prospect"; subject: string; body: string; at: Date };

export type TriageInput = { offer: CampaignOffer; company: Company; contact: Contact; thread: ThreadItem[] };

export type LinkInput = {
  kind: LinkKind;
  url: string;
  country: string;
  offer: CampaignOffer;
  /** Site de l'entreprise (kind own / target), null s'il n'a pas pu être lu. */
  site: SiteDigest | null;
  /** Page lue (kind list). */
  page: LinkPage | null;
};

export type LinkResult = {
  plan: PlanResponse;
  /** La phrase « client idéal » déduite du lien. */
  prompt: string;
  /** Offre déduite du site de l'utilisateur (kind own). */
  offer: Partial<CampaignOffer>;
  /** Entreprises à prospecter en priorité (liste, ou l'entreprise cible). */
  companies: ImportedCompany[];
  /** Exemples de clients idéaux pour chercher des sosies. */
  seeds: string[];
  /** Ce que contient le lien, pour l'affichage (« Exposants du salon X », « Acme — agence web »…). */
  title: string;
  /** Entreprises de la liste écartées car situées hors du pays choisi. */
  outsideCountry: number;
};

export type ResolveInput = { companies: { name: string; hint?: string }[]; country: string };

/** Le « cerveau » de l'agent. Deux implémentations : LLM réel (Anthropic ou OpenRouter) et démo (simulé). */
export interface Intelligence {
  readonly name: string;
  plan(input: { prompt: string; offer: CampaignOffer }, ctx: AiContext): Promise<PlanResponse>;
  discover(input: DiscoverInput, ctx: AiContext): Promise<{ companies: CompanyCandidate[]; sources: string[]; via: string }>;
  analyze(input: AnalyzeInput, ctx: AiContext): Promise<Analysis & { sources: string[] }>;
  findPeople(input: PeopleInput, ctx: AiContext): Promise<PeopleResult & { sources: string[] }>;
  writeSequence(input: WriteInput, ctx: AiContext): Promise<Sequence>;
  /** Construit le plan (et l'offre ou la liste d'entreprises) à partir d'un lien et d'un pays. */
  fromLink(input: LinkInput, ctx: AiContext): Promise<LinkResult>;
  /** Classe la dernière réponse d'un prospect et prépare notre réponse. */
  triageReply(input: TriageInput, ctx: AiContext): Promise<Triage>;
  /** Génère le visuel promo offert à une entreprise (à son image). */
  generateVisual(input: VisualInput, ctx: AiContext): Promise<{ mime: string; data: Buffer; prompt: string }>;
  /** Retrouve le site officiel d'entreprises connues seulement par leur nom. */
  resolveDomains(input: ResolveInput, ctx: AiContext): Promise<{ name: string; domain: string | null }[]>;
}
