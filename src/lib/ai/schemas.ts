import { z } from "zod";
import { CampaignPlanSchema } from "@/lib/types";

export const PlanResponseSchema = CampaignPlanSchema.extend({
  campaignName: z.string().describe("Nom court de campagne (3 à 6 mots)"),
  feasible: z
    .boolean()
    .describe("true si la demande décrit des entreprises ou organisations à prospecter (B2B), false sinon"),
  feasibilityIssue: z
    .string()
    .nullable()
    .describe("Si feasible=false : explication courte en français et suggestion de cible B2B ; sinon null"),
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
      email: z.string().nullable().describe("Email uniquement s'il est publié explicitement ou fourni par la base de données B2B"),
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

// ───────────────────────────── Prospection à partir d'un lien ─────────────────────────────

const idealCustomer = z
  .string()
  .describe("Le client idéal en une phrase, comme si l'utilisateur l'avait écrite (secteur, pays, taille, situation)");

/** Site de l'entreprise de l'utilisateur : son offre + le plan pour trouver ses clients. */
export const OwnSiteSchema = PlanResponseSchema.extend({
  idealCustomer,
  senderCompany: z.string().describe("Nom commercial de l'entreprise de l'utilisateur"),
  product: z.string().describe("Ce qu'elle vend, en une phrase"),
  valueProposition: z.string().describe("Bénéfice concret pour ses clients, 1 à 2 phrases, sans inventer de chiffres"),
});
export type OwnSite = z.infer<typeof OwnSiteSchema>;

/** Site d'une entreprise cible : le plan pour trouver des entreprises similaires. */
export const TargetSiteSchema = PlanResponseSchema.extend({
  idealCustomer,
  targetName: z.string().describe("Nom commercial de l'entreprise exemple"),
  targetSummary: z.string().describe("Ce que fait l'entreprise exemple, en une phrase"),
});
export type TargetSite = z.infer<typeof TargetSiteSchema>;

/** Entreprises lues sur une page qui en liste plusieurs (annuaire, exposants, classement, membres…). */
export const ListExtractionSchema = z.object({
  listTitle: z.string().describe("Ce que liste la page, en quelques mots (ex. « Exposants du salon X 2026 »)"),
  companies: z.array(
    z.object({
      name: z.string(),
      domain: z
        .string()
        .nullable()
        .describe("Domaine du site officiel s'il figure dans les liens de la page ou si tu le connais avec certitude ; sinon null"),
      inTargetCountry: z
        .boolean()
        .nullable()
        .describe("true si l'entreprise est dans le pays choisi, false si elle est clairement ailleurs, null si on ne sait pas"),
      reason: z.string().describe("Ce que la page dit de l'entreprise (activité, catégorie), en quelques mots"),
    }),
  ),
});
export type ListExtraction = z.infer<typeof ListExtractionSchema>;

/** Plan construit à partir d'une liste : le profil commun des entreprises listées. */
export const ListPlanSchema = PlanResponseSchema.extend({ idealCustomer });

/** Sites officiels retrouvés à partir de noms d'entreprises. */
export const ResolveSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      domain: z.string().nullable().describe("Domaine du site officiel vérifié, ex. 'acme.ci' ; null si introuvable ou incertain"),
    }),
  ),
});

// ───────────────────────────── Réponses des prospects ─────────────────────────────

export const REPLY_CATEGORIES = ["interested", "question", "not_now", "not_interested", "unsubscribe", "auto", "other"] as const;

export const TriageSchema = z.object({
  category: z
    .enum(REPLY_CATEGORIES)
    .describe(
      "interested : veut avancer (oui, intéressé, envoyez, appelons-nous) ; question : demande une information (prix, délai, exemple…) ; not_now : pas maintenant, plus tard ; not_interested : non merci ; unsubscribe : demande de ne plus être contacté ; auto : réponse automatique (absence, accusé de réception) ; other : autre",
    ),
  summary: z.string().describe("Ce que dit le prospect, en une phrase, en français"),
  needsReply: z.boolean().describe("true si une réponse de notre part est utile"),
  subject: z.string().describe("Objet de notre réponse : « Re: » + objet du fil"),
  body: z.string().describe("Notre réponse, texte brut, signée ; chaîne vide si needsReply=false"),
});
export type Triage = z.infer<typeof TriageSchema>;

// ───────────────────────────── Facebook ─────────────────────────────

export const SocialMessageSchema = z.object({
  message: z.string().describe("Le message Messenger, texte brut, prêt à coller"),
});
export type SocialMessage = z.infer<typeof SocialMessageSchema>;

export const AdCopySchema = z.object({
  primaryTexts: z.array(z.string()).describe("3 textes principaux d'annonce (125 à 300 caractères), angles différents"),
  headlines: z.array(z.string()).describe("3 titres courts (40 caractères au plus)"),
  descriptions: z.array(z.string()).describe("2 descriptions courtes (30 caractères au plus)"),
  callToAction: z.enum(["LEARN_MORE", "SEND_MESSAGE", "CONTACT_US", "GET_QUOTE", "SIGN_UP", "BOOK_NOW"]).describe("Bouton d'action Meta le plus adapté"),
});
export type AdCopy = z.infer<typeof AdCopySchema>;
