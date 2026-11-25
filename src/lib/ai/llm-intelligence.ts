import { research, structured } from "./llm";
import { AnalysisSchema, DiscoverySchema, PeopleSchema, PlanResponseSchema, SequenceSchema } from "./schemas";
import type { Intelligence } from "./intelligence";
import { digestToPrompt } from "@/lib/scrape/site";
import { formatResults, searchProviderName, webSearch, type SearchResult } from "@/lib/search";
import { isNonCompanyDomain, mapLimit, normalizeDomain, uniq } from "@/lib/util";
import type { CampaignPlan, CompanyCandidate } from "@/lib/types";

function planToText(plan: CampaignPlan): string {
  return [
    `Résumé : ${plan.summary}`,
    `Secteurs : ${plan.industries.join(", ")}`,
    `Zones : ${plan.geographies.join(", ")}`,
    `Taille : ${plan.companySize}`,
    `Mots-clés : ${plan.keywords.join(", ")}`,
    `Décideurs visés : ${plan.personas.join(", ")}`,
    `Signaux d'achat : ${plan.signals.join(", ")}`,
    `Exclusions : ${plan.exclusions.join(", ") || "aucune"}`,
    `Critères de qualification : ${plan.qualificationCriteria.join(" ; ")}`,
  ].join("\n");
}

const RESEARCHER = `Tu es un chercheur B2B d'élite (Sales Development / intelligence commerciale).
Tu trouves des entreprises et des décideurs réels et vérifiables. Tu privilégies les sources primaires
(site officiel, mentions légales, pages équipe, communiqués, offres d'emploi, registres publics, presse).
Tu ne fabriques jamais de nom, de domaine ou d'email.`;

/** Angles de recherche pour varier les rounds de découverte. */
const ANGLES = [
  "listes, classements et annuaires sectoriels pour extraire des noms d'entreprises",
  "acteurs de niche et entreprises moins visibles (PME, ETI régionales)",
  "entreprises qui recrutent ou annoncent une croissance récente",
  "entreprises citées dans la presse spécialisée, salons et événements du secteur",
  "concurrents et sociétés similaires aux meilleurs résultats déjà trouvés",
  "associations professionnelles, clusters, pôles de compétitivité et leurs membres",
];

/** Intelligence réelle : Claude via Anthropic, ou le modèle choisi via OpenRouter. */
export class LlmIntelligence implements Intelligence {
  readonly name = "llm";

  async plan({ prompt, offer }: Parameters<Intelligence["plan"]>[0], ctx: Parameters<Intelligence["plan"]>[1]) {
    return structured({
      operation: "plan",
      ctx,
      schema: PlanResponseSchema,
      effort: "medium",
      system: `${RESEARCHER}
Ta mission : transformer la description d'un client idéal (ICP), écrite en une phrase, en un plan de prospection
précis et actionnable. Les requêtes de recherche doivent être concrètes, variées (au moins 8), dans la langue des
marchés ciblés, et viser des pages qui listent ou décrivent des entreprises cibles. Les personas sont des intitulés
de poste réalistes (dans la langue du marché). Écris le reste du plan en français.`,
      prompt: `Description du client idéal :\n"""${prompt}"""\n\nCe que vend l'utilisateur (pour comprendre le besoin) :\n${
        [offer.senderCompany, offer.product, offer.valueProposition].filter(Boolean).join(" — ") || "non précisé"
      }`,
    });
  }

  async discover(input: Parameters<Intelligence["discover"]>[0], ctx: Parameters<Intelligence["discover"]>[1]) {
    const { plan, count, exclude, round, seeds, prompt } = input;
    const angle = ANGLES[round % ANGLES.length];
    const excluded = new Set(exclude);
    const found: CompanyCandidate[] = [];
    const sources: string[] = [];
    let via = "claude-web";

    // 1) Moteur de recherche configuré (Serper/Brave/Tavily) + extraction par l'IA
    const provider = searchProviderName();
    if (provider) {
      const start = (round * 3) % Math.max(1, plan.searchQueries.length);
      const queries = [...plan.searchQueries, ...plan.searchQueries].slice(start, start + 4);
      const results = (await mapLimit(queries, 4, (q) => webSearch(q, 10))).flat();
      const unique = uniq(results, (r: SearchResult) => r.url);
      if (unique.length) {
        via = provider;
        const extracted = await structured({
          operation: "discover.extract",
          ctx,
          fast: true,
          effort: "low",
          schema: DiscoverySchema,
          system: `${RESEARCHER}\nExtrais des résultats de recherche les entreprises qui correspondent au profil. Ignore annuaires, médias et réseaux sociaux eux-mêmes, mais extrais les entreprises qu'ils citent. Ne renvoie que les entreprises dont tu connais ou vois le domaine officiel avec certitude.`,
          prompt: `Profil :\n${planToText(plan)}\n\nDéjà trouvées (à ignorer) : ${[...excluded].slice(0, 300).join(", ") || "aucune"}\n\nRésultats :\n${formatResults(unique.slice(0, 40))}`,
        });
        for (const c of extracted.companies) found.push({ name: c.name, domain: c.domain, reason: c.reason, source: c.sourceUrl ?? undefined });
        sources.push(...unique.map((r) => r.url));
      }
    }

    // 2) Recherche web autonome par Claude (complète ou remplace le moteur)
    const clean = () =>
      uniq(
        found
          .map((c) => ({ ...c, domain: normalizeDomain(c.domain) ?? "" }))
          .filter((c) => c.domain && !excluded.has(c.domain) && !isNonCompanyDomain(c.domain)),
        (c) => c.domain,
      );
    if (clean().length < count) {
      const need = count - clean().length;
      const res = await research({
        operation: "discover.web",
        ctx,
        schema: DiscoverySchema,
        maxSearches: Math.min(15, 4 + Math.ceil(need / 3)),
        effort: "medium",
        system: RESEARCHER,
        prompt: `Trouve ${need} entreprises réelles qui correspondent à ce profil client idéal.

Demande initiale : "${prompt}"

${planToText(plan)}

Pistes de requêtes : ${plan.searchQueries.join(" | ")}
${seeds.length ? `Exemples de clients idéaux (cherche des entreprises similaires) : ${seeds.join(", ")}` : ""}
Angle de ce tour de recherche : ${angle}.

N'inclus PAS ces domaines déjà trouvés : ${[...excluded, ...clean().map((c) => c.domain)].slice(0, 400).join(", ") || "aucun"}.
Pour chaque entreprise : nom, domaine du site officiel (vérifié), raison de la correspondance, URL source.`,
      });
      for (const c of res.data.companies) found.push({ name: c.name, domain: c.domain, reason: c.reason, source: c.sourceUrl ?? undefined });
      sources.push(...res.sources);
      via = provider ? `${provider}+claude-web` : "claude-web";
    }

    return { companies: clean().slice(0, count), sources: uniq(sources), via };
  }

  async analyze(input: Parameters<Intelligence["analyze"]>[0], ctx: Parameters<Intelligence["analyze"]>[1]) {
    const { plan, prompt, candidate, digest, deep } = input;
    const system = `${RESEARCHER}
Tu qualifies une entreprise par rapport au profil client idéal. Sois exigeant et factuel : une note ≥ 80 signifie
« cible évidente », 60-79 « bonne cible probable », 40-59 « incertain », < 40 « hors cible ».
Repère les signaux d'achat (recrutements, levées, ouvertures de sites, lancements, changements de direction…)
et toutes les personnes nommées avec leur fonction (pages équipe, mentions légales : directeur de publication, etc.).`;
    const base = `Profil client idéal (demande : "${prompt}")\n${planToText(plan)}\n\nEntreprise candidate : ${candidate.name} (${candidate.domain})\nRaison de la sélection : ${candidate.reason ?? "—"}`;

    if (digest && !deep) {
      const res = await structured({
        operation: "analyze",
        ctx,
        fast: true,
        effort: "low",
        schema: AnalysisSchema,
        system,
        prompt: `${base}\n\nContenu du site :\n${digestToPrompt(digest)}`,
      });
      return { ...res, sources: [digest.url] };
    }

    const res = await research({
      operation: "analyze.deep",
      ctx,
      schema: AnalysisSchema,
      maxSearches: digest ? 3 : 5,
      effort: "low",
      fast: true,
      system,
      prompt: `${base}\n\n${
        digest
          ? `Contenu du site officiel :\n${digestToPrompt(digest, 10000)}\n\nComplète par quelques recherches web ciblées : actualités récentes (12 derniers mois), recrutements, levées de fonds, croissance, taille réelle.`
          : "Le site n'a pas pu être lu : recherche les informations sur le web (site officiel, presse, registres)."
      }`,
    });
    return { ...res.data, sources: uniq([...(digest ? [digest.url] : []), ...res.sources]) };
  }

  async findPeople(input: Parameters<Intelligence["findPeople"]>[0], ctx: Parameters<Intelligence["findPeople"]>[1]) {
    const { plan, company, count, deep } = input;
    const known = company.people.map((p) => `- ${p.name}${p.title ? ` — ${p.title}` : ""}${p.email ? ` <${p.email}>` : ""}`).join("\n");
    const system = `${RESEARCHER}
Tu identifies les meilleurs interlocuteurs (décideurs) dans une entreprise pour une prospection B2B.
Uniquement des personnes ACTUELLEMENT en poste dans cette entreprise, avec leur intitulé exact.
Classe-les par pertinence vis-à-vis des personas ciblés.`;
    const context = `Entreprise : ${company.name} (${company.domain}) — ${company.description ?? ""}
Pays : ${company.country ?? "?"} — Effectif : ${company.employeeRange ?? "?"}
Personas ciblés (par ordre de priorité) : ${plan.personas.join(", ")}
Personnes déjà repérées sur le site :\n${known || "aucune"}
Nombre de contacts souhaités : ${count}`;

    const provider = searchProviderName();
    let serp = "";
    const sources: string[] = [];
    if (provider) {
      const titles = plan.personas.slice(0, 4).map((t) => `"${t}"`).join(" OR ");
      const results = await webSearch(`site:linkedin.com/in "${company.name}" (${titles})`, 10);
      const more = await webSearch(`"${company.name}" ${plan.personas.slice(0, 2).join(" ")} ${company.domain}`, 8);
      const all = uniq([...results, ...more], (r) => r.url);
      serp = formatResults(all);
      sources.push(...all.map((r) => r.url));
    }

    if (!deep && (serp || company.people.length >= count)) {
      const res = await structured({
        operation: "people.rank",
        ctx,
        fast: true,
        effort: "low",
        schema: PeopleSchema,
        system,
        prompt: `${context}\n\n${serp ? `Résultats de recherche :\n${serp}` : ""}`,
      });
      return { ...res, sources };
    }

    const res = await research({
      operation: "people.web",
      ctx,
      schema: PeopleSchema,
      maxSearches: 6,
      effort: "low",
      fast: true,
      system,
      prompt: `${context}\n\n${serp ? `Résultats de recherche déjà disponibles :\n${serp}\n\n` : ""}Trouve les ${count} meilleurs décideurs (nom, poste, profil LinkedIn si trouvé) et les signaux d'achat récents de l'entreprise (recrutements, levée, expansion, nouveaux produits, actualité des 12 derniers mois).`,
    });
    return { ...res.data, sources: uniq([...sources, ...res.sources]) };
  }

  async writeSequence(input: Parameters<Intelligence["writeSequence"]>[0], ctx: Parameters<Intelligence["writeSequence"]>[1]) {
    const { offer, company, contact, steps, followUpDays, plan } = input;
    const language = offer.language && offer.language !== "auto" ? offer.language : company.language || "fr";
    const signals = company.signals.map((s) => `- [${s.type}] ${s.text}${s.date ? ` (${s.date})` : ""}`).join("\n");
    return structured({
      operation: "write",
      ctx,
      effort: "medium",
      schema: SequenceSchema,
      system: `Tu es un copywriter B2B expert en cold emailing à fort taux de réponse.
Règles :
- Écris dans la langue « ${language} » (vouvoiement en français).
- Première ligne hyper-personnalisée, fondée sur un fait réel et précis de la recherche (signal, actualité, détail du site). Jamais de flatterie générique.
- Un seul problème, une seule proposition de valeur, un seul appel à l'action, à faible friction.
- 60 à 120 mots pour le premier email, 40 à 80 pour les relances. Texte brut, paragraphes courts, aucun lien, aucune pièce jointe, aucun emoji.
- Les relances apportent un angle nouveau (preuve, cas client, question) et ne disent pas « je me permets de relancer ».
- Objets courts (2 à 6 mots), naturels, en minuscules sauf noms propres.
- N'invente aucun chiffre, client ou résultat qui ne figure pas dans l'offre.
- Signe avec le prénom et nom de l'expéditeur et son entreprise. N'ajoute pas de lien de désinscription (ajouté automatiquement).`,
      prompt: `EXPÉDITEUR
Entreprise : ${offer.senderCompany || "—"}
Nom : ${offer.senderName || "—"}
Offre : ${offer.product || "—"}
Proposition de valeur : ${offer.valueProposition || "—"}
Appel à l'action : ${offer.callToAction}
Ton : ${offer.tone}

DESTINATAIRE
${contact.fullName} — ${contact.title ?? "poste inconnu"} chez ${company.name} (${company.domain})
Pourquoi cette personne : ${contact.relevanceReason ?? "—"}

ENTREPRISE (recherche)
${company.description ?? ""}
Secteur : ${company.industry ?? "?"} — Localisation : ${company.location ?? "?"}, ${company.country ?? "?"} — Effectif : ${company.employeeRange ?? "?"}
Technologies : ${company.techStack.join(", ") || "?"}
Pourquoi elle correspond : ${company.scoreReasons.join(" ; ")}
Signaux :\n${signals || "aucun"}

CIBLE GLOBALE : ${plan.summary}

Rédige une séquence de ${steps} email(s). Délai entre chaque relance : ${followUpDays} jours (delayDays=0 pour le premier).`,
    });
  }
}
