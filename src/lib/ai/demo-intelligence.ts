import type { Intelligence, LinkResult } from "./intelligence";
import type { PlanResponse } from "./schemas";
import { hashString, normalizeDomain, sleep, splitName } from "@/lib/util";

/**
 * Intelligence simulée : permet d'explorer toute l'application sans clé API.
 * Les entreprises et personnes sont fictives (domaines réservés en .example).
 */
function rng(seed: string) {
  let s = hashString(seed) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}
const pick = <T,>(r: () => number, arr: T[]) => arr[Math.floor(r() * arr.length)];

const PREFIX = ["Nova", "Altis", "Quantum", "Lumen", "Vertex", "Orbis", "Helio", "Kairos", "Sigma", "Atlas", "Nexa", "Ocea", "Vela", "Terra", "Axio", "Cobalt", "Elan", "Fluxo", "Granit", "Iris"];
const SUFFIX = ["Logistique", "Tech", "Solutions", "Industrie", "Conseil", "Digital", "Systèmes", "Services", "Group", "Labs", "Énergie", "Santé", "Data", "Factory", "Partners"];
const CITIES = ["Lyon", "Nantes", "Lille", "Bordeaux", "Toulouse", "Rennes", "Grenoble", "Marseille", "Paris", "Strasbourg", "Montpellier", "Nice"];
const FIRST = ["Camille", "Julien", "Sophie", "Thomas", "Claire", "Nicolas", "Émilie", "Antoine", "Laura", "Mathieu", "Sarah", "Hugo", "Inès", "Romain", "Chloé", "Maxime"];
const LAST = ["Martin", "Bernard", "Dubois", "Lefèvre", "Moreau", "Laurent", "Girard", "Roux", "Fournier", "Mercier", "Blanc", "Garnier", "Chevalier", "Perrin", "Morel", "Fontaine"];
const SIGNALS = [
  { type: "hiring" as const, text: "Recrute actuellement 3 commerciaux terrain et un responsable des opérations" },
  { type: "funding" as const, text: "A annoncé une levée de fonds de 4 M€ pour accélérer son développement" },
  { type: "growth" as const, text: "Ouverture d'un nouveau site / bureau régional cette année" },
  { type: "news" as const, text: "Lancement d'une nouvelle offre présentée dans la presse spécialisée" },
  { type: "tech" as const, text: "Migration récente vers un nouvel outil CRM visible sur le site" },
  { type: "event" as const, text: "Exposant au principal salon professionnel du secteur ce trimestre" },
];
const TECH = ["WordPress", "HubSpot", "Google Analytics", "Webflow", "Intercom", "Shopify", "Axeptio", "Calendly", "Matomo", "Next.js"];

function slug(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export class DemoIntelligence implements Intelligence {
  readonly name = "demo";

  async plan({ prompt }: { prompt: string }): Promise<PlanResponse> {
    await sleep(1200);
    const words = prompt.split(/[\s,.;]+/).filter((w) => w.length > 4).slice(0, 6);
    return {
      campaignName: `Prospection — ${prompt.slice(0, 40)}${prompt.length > 40 ? "…" : ""}`,
      feasible: true,
      feasibilityIssue: null,
      summary: prompt,
      industries: words.length ? words.slice(0, 3) : ["Services B2B"],
      geographies: ["France"],
      companySize: "11-500 salariés",
      keywords: words,
      personas: ["Directeur général", "Directeur commercial", "Directeur des opérations"],
      signals: ["Recrutements en cours", "Levée de fonds récente", "Ouverture de nouveaux sites"],
      exclusions: ["Grands groupes du CAC 40", "Administrations publiques"],
      searchQueries: words.map((w) => `entreprises ${w} France`).concat([`meilleures PME ${words[0] ?? "B2B"} 2026`]),
      qualificationCriteria: ["Activité alignée avec la demande", "Taille compatible", "Présence en France", "Signal de croissance"],
    };
  }

  async discover({ count, exclude, round, prompt }: Parameters<Intelligence["discover"]>[0]) {
    await sleep(1500);
    const r = rng(`${prompt}-${round}`);
    const excluded = new Set(exclude);
    const companies = [];
    for (let i = 0; companies.length < count && i < count * 4; i++) {
      const name = `${pick(r, PREFIX)} ${pick(r, SUFFIX)}`;
      const domain = `${slug(name)}.example`;
      if (excluded.has(domain)) continue;
      excluded.add(domain);
      companies.push({ name, domain, reason: `Correspond au profil « ${prompt.slice(0, 60)} »`, source: `https://${domain}` });
    }
    return { companies, sources: [], via: "demo" };
  }

  async analyze({ candidate, plan }: Parameters<Intelligence["analyze"]>[0]) {
    await sleep(800 + Math.random() * 1500);
    const r = rng(candidate.domain);
    const score = Math.round(35 + r() * 62);
    const city = pick(r, CITIES);
    const people = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({
      name: `${pick(r, FIRST)} ${pick(r, LAST)}`,
      title: pick(r, plan.personas.length ? plan.personas : ["Directeur général"]),
      email: null,
      linkedinUrl: null,
    }));
    return {
      name: candidate.name,
      description: `${candidate.name} accompagne les entreprises de sa région avec une offre de ${plan.industries[0] ?? "services"} sur mesure. Basée à ${city}, elle vise une croissance nationale.`,
      industry: plan.industries[0] ?? "Services B2B",
      employeeRange: pick(r, ["11-50", "51-200", "201-500"]),
      location: city,
      country: "France",
      language: "fr",
      linkedinUrl: null,
      fitScore: score,
      fitReasons: [
        score >= 60 ? "Activité très proche du profil recherché" : "Activité partiellement alignée",
        `Siège à ${city}, dans la zone ciblée`,
        score >= 75 ? "Signal de croissance récent" : "Peu de signaux d'achat visibles",
      ],
      disqualified: score < 40,
      disqualificationReason: score < 40 ? "Activité trop éloignée du profil" : null,
      signals: score >= 55 ? [{ ...pick(r, SIGNALS), source: null, date: "2026-10" }] : [],
      people,
      sources: [`https://${candidate.domain}`],
    };
  }

  async findPeople({ company, count, plan }: Parameters<Intelligence["findPeople"]>[0]) {
    await sleep(900 + Math.random() * 1200);
    const r = rng(`${company.domain}-people`);
    const fromSite = company.people.map((p) => ({ name: p.name, title: p.title ?? "Dirigeant" }));
    const extra = Array.from({ length: count + 1 }, (_, i) => ({
      name: `${pick(r, FIRST)} ${pick(r, LAST)}`,
      title: plan.personas[i % Math.max(1, plan.personas.length)] ?? "Directeur",
    }));
    const people = [...fromSite, ...extra].slice(0, count + 1).map((p, i) => {
      const { first, last } = splitName(p.name);
      return {
        name: p.name,
        title: p.title,
        seniority: (i === 0 ? "c_level" : "director") as "c_level" | "director",
        linkedinUrl: `https://www.linkedin.com/in/${slug(first)}-${slug(last)}-demo`,
        email: null,
        sourceUrl: null,
        relevance: Math.max(40, 95 - i * 12),
        reason: `${p.title} : décide sur le sujet ciblé`,
      };
    });
    return { people, signals: [pick(r, SIGNALS)].map((s) => ({ ...s, source: null, date: "2026-11" })), sources: [] };
  }

  async writeSequence({ contact, company, offer, steps, followUpDays, sampleUrl }: Parameters<Intelligence["writeSequence"]>[0]) {
    await sleep(1000);
    const first = splitName(contact.fullName).first;
    const signal = company.signals[0]?.text ?? `Développement de l'activité à ${company.location ?? "votre siège"}`;
    const vp = offer.valueProposition || "nous aidons des entreprises comme la vôtre à gagner du temps sur leur prospection";
    const valueProp = vp.charAt(0).toLowerCase() + vp.slice(1);
    const sender = `${offer.senderName || "Alex Dupont"}\n${offer.senderCompany || "Votre entreprise"}`;
    const all = [
      {
        subject: `${company.name} et ${offer.product ? offer.product.split(" ").slice(0, 3).join(" ") : "votre croissance"}`,
        body: `Bonjour ${first},\n\nUne actualité a retenu mon attention chez ${company.name} : « ${signal.replace(/\.$/, "")} ». Dans ce contexte, ${valueProp.replace(/\.$/, "")}.${sampleUrl ? `\n\nJ'ai préparé gratuitement un visuel pour ${company.name}, à votre image :\n${sampleUrl}` : ""}\n\nSeriez-vous ouvert(e) à ${offer.callToAction} la semaine prochaine pour voir si c'est pertinent pour vous ?${offer.bookingUrl ? `\nVous pouvez choisir un créneau ici :\n${offer.bookingUrl}` : ""}\n\nBien à vous,\n${sender}`,
        delayDays: 0,
      },
      {
        subject: "une question rapide",
        body: `Bonjour ${first},\n\nPour être concret : quelle est aujourd'hui votre principale difficulté sur ce sujet en tant que ${contact.title ?? "responsable"} ?\n\nSi ce n'est pas une priorité, dites-le moi simplement.\n\n${sender}`,
        delayDays: followUpDays,
      },
      {
        subject: `dernier message ${first.toLowerCase()}`,
        body: `Bonjour ${first},\n\nJe ne veux pas encombrer votre boîte. Si le sujet revient d'actualité chez ${company.name}, je reste disponible.${offer.bookingUrl ? `\nMon agenda : ${offer.bookingUrl}` : ""}\n\nBonne continuation,\n${sender}`,
        delayDays: followUpDays,
      },
    ];
    return { language: "fr", steps: all.slice(0, steps) };
  }

  async fromLink({ kind, url, country, site, page }: Parameters<Intelligence["fromLink"]>[0]): Promise<LinkResult> {
    const domain = site?.domain ?? page?.domain ?? normalizeDomain(url) ?? "site";
    const name = site?.title || page?.title || domain;
    const prompt =
      kind === "own"
        ? `Entreprises en ${country} qui ont besoin de l'offre de ${name}`
        : kind === "target"
          ? `Entreprises similaires à ${name} en ${country}`
          : `Entreprises de la liste « ${name} » en ${country}`;
    const plan = await this.plan({ prompt });
    const companies =
      kind === "list"
        ? (page?.links ?? []).slice(0, 50).map((l) => ({ name: l.text || l.domain, domain: l.domain, reason: "Citée sur la page", source: url }))
        : kind === "target"
          ? [{ name, domain, reason: "Entreprise exemple", source: url }]
          : [];
    return {
      plan: { ...plan, geographies: [country], searchQueries: plan.searchQueries.map((q) => q.replace("France", country)) },
      prompt,
      offer: kind === "own" ? { senderCompany: name, product: `Les services de ${name}` } : {},
      companies,
      seeds: kind === "target" ? [domain] : [],
      title: name,
      outsideCountry: 0,
    };
  }

  async resolveDomains({ companies }: Parameters<Intelligence["resolveDomains"]>[0]) {
    return companies.map((c) => ({ name: c.name, domain: `${slug(c.name)}.example` }));
  }

  async generateVisual({ company, brief }: Parameters<Intelligence["generateVisual"]>[0]) {
    await sleep(300);
    const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
<rect width="1080" height="1080" fill="url(#g)"/>
<text x="540" y="520" font-family="Arial, sans-serif" font-size="72" font-weight="700" fill="#fff" text-anchor="middle">${esc(company.name)}</text>
<text x="540" y="600" font-family="Arial, sans-serif" font-size="32" fill="#e0e7ff" text-anchor="middle">${esc(company.industry ?? "Visuel de démonstration")}</text>
</svg>`;
    return { mime: "image/svg+xml", data: Buffer.from(svg), prompt: `Démo — ${brief}` };
  }

  async triageReply({ thread, contact, offer }: Parameters<Intelligence["triageReply"]>[0]) {
    await sleep(200);
    const last = [...thread].reverse().find((t) => t.from === "prospect");
    const text = `${last?.subject ?? ""}\n${last?.body ?? ""}`.toLowerCase();
    const category = /unsubscribe|remove me|désinscri|ne plus (me )?contacter|stop/.test(text)
      ? "unsubscribe"
      : /out of office|absent|automatic reply|réponse automatique/.test(text)
        ? "auto"
        : /not interested|pas intéress|no thanks|non merci/.test(text)
          ? "not_interested"
          : /\?|how much|price|combien|tarif|prix/.test(text)
            ? "question"
            : /later|plus tard|next (month|year)|pas maintenant/.test(text)
              ? "not_now"
              : /yes|interested|intéress|sounds good|d'accord|ok\b/.test(text)
                ? "interested"
                : "other";
    const needsReply = category !== "unsubscribe" && category !== "auto";
    const first = splitName(contact.fullName).first;
    return {
      category,
      summary: `${contact.fullName} : ${(last?.body ?? "").split("\n")[0].slice(0, 120)}`,
      needsReply,
      subject: `Re: ${(last?.subject ?? "").replace(/^re:\s*/i, "")}`,
      body: needsReply
        ? `Bonjour ${first},\n\nMerci pour votre retour. ${offer.pricing ? `Nos tarifs : ${offer.pricing}.` : "Je vous propose un court échange pour en parler."}\n\nBien à vous,\n${offer.senderName || "—"}\n${offer.senderCompany || ""}`
        : "",
    } as const;
  }
}
