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
  /** Tarifs et conditions, pour que l'IA réponde aux questions de prix sans rien inventer. */
  pricing: z.string().max(2000).optional(),
  bookingUrl: z.string().default(""),
  tone: z.string().default("professionnel et chaleureux"),
  language: z.string().default("auto"),
});
export type CampaignOffer = z.infer<typeof CampaignOfferSchema>;

/** Entreprise trouvée sur une page fournie par l'utilisateur ; domaine vide = à retrouver lors de la découverte. */
export const ImportedCompanySchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(253).default(""),
  reason: z.string().max(300).optional(),
  source: z.string().max(2000).optional(),
});
export type ImportedCompany = z.infer<typeof ImportedCompanySchema>;

export const LINK_KINDS = ["own", "list", "target"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

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
  /** Entreprises importées depuis un lien (annuaire, liste d'exposants…), prospectées avant toute recherche. */
  importedCompanies: z.array(ImportedCompanySchema).max(500).optional(),
  /** Nombre d'entreprises importées déjà traitées par la découverte. */
  importCursor: z.number().int().min(0).optional(),
  /** true : ne prospecter que les entreprises importées (pas de recherche d'entreprises similaires). */
  importOnly: z.boolean().optional(),
  /** Offrir à chaque entreprise qualifiée un visuel promo à son image, cité dans le premier email. */
  visualSample: z.boolean().optional(),
  /** Ce que doit montrer le visuel (ex. « affiche promo pour Instagram »). */
  visualBrief: z.string().max(500).optional(),
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
