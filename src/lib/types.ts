import { z } from "zod";

/** Plan de ciblage (ICP) produit par l'IA à partir d'une phrase en langage naturel. */
export const CampaignPlanSchema = z.object({
  summary: z.string().describe("Résumé en une phrase du client idéal"),
  industries: z.array(z.string()).describe("Secteurs / sous-secteurs ciblés"),
  geographies: z.array(z.string()).describe("Pays, régions ou villes ciblés"),
  companySize: z.string().describe("Taille d'entreprise visée, ex. '11-200 salariés'"),
  keywords: z.array(z.string()).describe("Mots-clés qui caractérisent les entreprises cibles"),
  personas: z.array(z.string()).describe("Intitulés de poste des décideurs à contacter"),
  signals: z.array(z.string()).describe("Signaux d'achat à rechercher (recrutement, levée, expansion…)"),
  exclusions: z.array(z.string()).describe("Critères d'exclusion"),
  searchQueries: z.array(z.string()).describe("Requêtes web variées pour trouver des entreprises cibles"),
  qualificationCriteria: z.array(z.string()).describe("Critères concrets pour noter l'adéquation d'une entreprise"),
});
export type CampaignPlan = z.infer<typeof CampaignPlanSchema>;

export const CampaignOfferSchema = z.object({
  senderCompany: z.string().default(""),
  senderName: z.string().default(""),
  product: z.string().default(""),
  valueProposition: z.string().default(""),
  callToAction: z.string().default("un échange de 15 minutes"),
  tone: z.string().default("professionnel et chaleureux"),
  language: z.string().default("auto"),
});
export type CampaignOffer = z.infer<typeof CampaignOfferSchema>;

export const CampaignSettingsSchema = z.object({
  targetCompanies: z.number().int().min(1).max(1000).default(25),
  contactsPerCompany: z.number().int().min(1).max(10).default(2),
  minScore: z.number().int().min(0).max(100).default(60),
  autoWrite: z.boolean().default(true),
  deepResearch: z.boolean().default(true),
  sequenceSteps: z.number().int().min(1).max(5).default(3),
  followUpDays: z.number().int().min(1).max(30).default(3),
  seedDomains: z.array(z.string()).default([]),
  webhookUrl: z.string().default(""),
});
export type CampaignSettings = z.infer<typeof CampaignSettingsSchema>;

export type Signal = {
  type: "hiring" | "funding" | "growth" | "news" | "tech" | "event" | "other";
  text: string;
  source?: string;
  date?: string;
};

export type PersonHint = {
  name: string;
  title?: string;
  email?: string;
  linkedinUrl?: string;
  source?: string;
};

export type CompanyCandidate = {
  name: string;
  domain: string;
  reason?: string;
  source?: string;
};
