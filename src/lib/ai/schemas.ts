import { z } from "zod";
import { CampaignPlanSchema } from "@/lib/types";

export const PlanResponseSchema = CampaignPlanSchema.extend({
  campaignName: z.string().describe("Nom court de campagne (3 à 6 mots)"),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export const SignalSchema = z.object({
  type: z.enum(["hiring", "funding", "growth", "news", "tech", "event", "other"]),
  text: z.string().describe("Le signal, en une phrase factuelle"),
  source: z.string().nullable().describe("URL de la source"),
  date: z.string().nullable().describe("Date approximative (AAAA-MM) si connue"),
});

export const DiscoverySchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      domain: z.string().describe("Domaine du site officiel, ex. 'acme.fr' (pas d'annuaire, pas de réseau social)"),
      reason: z.string().describe("Pourquoi cette entreprise correspond au profil, en une phrase"),
      sourceUrl: z.string().nullable(),
    }),
  ),
});
export type Discovery = z.infer<typeof DiscoverySchema>;

export const AnalysisSchema = z.object({
  name: z.string().describe("Nom commercial de l'entreprise"),
  description: z.string().describe("Ce que fait l'entreprise, 2 phrases max, en français"),
  industry: z.string().describe("Secteur, en français"),
  employeeRange: z.string().describe("Effectif estimé : '1-10', '11-50', '51-200', '201-500', '501-1000', '1000+' ou 'inconnu'"),
  location: z.string().describe("Ville / région du siège, ou 'inconnu'"),
  country: z.string().describe("Pays du siège, ou 'inconnu'"),
  language: z.string().describe("Langue principale du site (code ISO, ex. 'fr', 'en')"),
  linkedinUrl: z.string().nullable(),
  fitScore: z.number().int().min(0).max(100).describe("Adéquation au profil client idéal, 0 à 100"),
  fitReasons: z.array(z.string()).describe("Points forts et points faibles qui justifient la note (3 à 6 puces)"),
  disqualified: z.boolean().describe("true si un critère d'exclusion est rempli ou si ce n'est pas une entreprise cible"),
  disqualificationReason: z.string().nullable(),
  signals: z.array(SignalSchema).describe("Signaux d'achat observés"),
  people: z
    .array(
      z.object({
        name: z.string(),
        title: z.string().nullable(),
        email: z.string().nullable(),
        linkedinUrl: z.string().nullable(),
      }),
    )
    .describe("Personnes nommées (dirigeants, responsables) trouvées dans le contenu"),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const PeopleSchema = z.object({
  people: z.array(
    z.object({
      name: z.string().describe("Prénom et nom"),
      title: z.string().describe("Intitulé de poste actuel"),
      seniority: z.enum(["c_level", "vp", "director", "manager", "senior", "other"]),
      linkedinUrl: z.string().nullable(),
      email: z.string().nullable().describe("Email uniquement s'il est publié explicitement"),
      sourceUrl: z.string().nullable(),
      relevance: z.number().int().min(0).max(100).describe("Pertinence vis-à-vis des personas ciblés"),
      reason: z.string().describe("Pourquoi cette personne est le bon interlocuteur"),
    }),
  ),
  signals: z.array(SignalSchema),
});
export type PeopleResult = z.infer<typeof PeopleSchema>;

export const SequenceSchema = z.object({
  language: z.string().describe("Langue utilisée (code ISO)"),
  steps: z.array(
    z.object({
      subject: z.string().describe("Objet court, sans majuscules agressives ni emoji"),
      body: z.string().describe("Corps en texte brut, avec sauts de ligne, signé avec le nom de l'expéditeur"),
      delayDays: z.number().int().min(0).max(30).describe("Jours après l'étape précédente (0 pour la première)"),
    }),
  ),
});
export type Sequence = z.infer<typeof SequenceSchema>;
