import type { AiContext } from "./usage";
import type { PlanResponse, Analysis, PeopleResult, Sequence } from "./schemas";
import type { CampaignOffer, CampaignPlan, CompanyCandidate } from "@/lib/types";
import type { SiteDigest } from "@/lib/scrape/site";
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
};

/** Le « cerveau » de l'agent. Deux implémentations : LLM réel (Anthropic ou OpenRouter) et démo (simulé). */
export interface Intelligence {
  readonly name: string;
  plan(input: { prompt: string; offer: CampaignOffer }, ctx: AiContext): Promise<PlanResponse>;
  discover(input: DiscoverInput, ctx: AiContext): Promise<{ companies: CompanyCandidate[]; sources: string[]; via: string }>;
  analyze(input: AnalyzeInput, ctx: AiContext): Promise<Analysis & { sources: string[] }>;
  findPeople(input: PeopleInput, ctx: AiContext): Promise<PeopleResult & { sources: string[] }>;
  writeSequence(input: WriteInput, ctx: AiContext): Promise<Sequence>;
}
