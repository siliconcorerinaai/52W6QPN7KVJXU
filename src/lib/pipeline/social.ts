/**
 * Assistant Facebook : pour chaque entreprise qualifiée, sa page Facebook et un message Messenger
 * personnalisé, prêt à coller. L'utilisateur l'envoie lui-même (Facebook interdit l'envoi automatisé),
 * puis indique s'il est parti et si l'entreprise a répondu.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { intelligence } from "@/lib/ai";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { campaigns, companies, contacts, messages, socialMessages, type SocialStatus } from "@/lib/db/schema";
import { logEvent } from "@/lib/events";
import { enqueue } from "@/lib/jobs/queue";
import { campaignIdsOf, canAccess, NotFoundError, type Owner } from "@/lib/ownership";
import { crawlCompanySite } from "@/lib/scrape/site";
import { facebookPageFrom, instagramFrom, messengerUrl, normalizeFacebookUrl } from "@/lib/social";
import { newId } from "@/lib/util";
import { sampleOf, sampleUrl } from "@/lib/visuals";
import { PlanError, setContactStatus } from "./campaigns";

/** Cherche la page Facebook (et Instagram) d'une entreprise sur la page d'accueil de son site. */
export async function findCompanySocials(companyId: string) {
  const db = await getDb();
  const [co] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!co || co.facebookUrl) return;
  const digest = config.demoMode ? null : await crawlCompanySite(co.domain, 1).catch(() => null);
  const socials = digest?.socials ?? [];
  const facebookUrl = config.demoMode ? `https://www.facebook.com/${co.domain.split(".")[0]}` : facebookPageFrom(socials);
  await db
    .update(companies)
    .set({ facebookUrl, instagramUrl: co.instagramUrl ?? instagramFrom(socials), socialsCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(companies.id, companyId));
  if (facebookUrl) await enqueue("social.write", { companyId }, { campaignId: co.campaignId, priority: 2 });
}

/** Rédige (ou réécrit) le message Messenger d'une entreprise qui a une page Facebook. */
export async function writeSocialMessage(companyId: string) {
  const db = await getDb();
  const [co] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!co?.facebookUrl) return;
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, co.campaignId));
  if (!c) return;
  const [existing] = await db.select().from(socialMessages).where(and(eq(socialMessages.companyId, companyId), eq(socialMessages.channel, "facebook")));
  if (existing && existing.status !== "todo") return; // déjà envoyé : on ne réécrit pas

  const [contact] = await db
    .select({ fullName: contacts.fullName, title: contacts.title })
    .from(contacts)
    .where(eq(contacts.companyId, companyId))
    .orderBy(desc(contacts.relevance))
    .limit(1);
  const sample = c.settings.visualSample ? await sampleOf(companyId) : null;
  const [sent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(and(eq(contacts.companyId, companyId), eq(messages.status, "sent")));

  const { message } = await intelligence().writeSocialMessage(
    {
      offer: c.offer,
      company: co,
      contact: contact ?? null,
      sampleUrl: sample?.status === "ready" ? sampleUrl(sample.id) : null,
      sampleVideo: sample?.video === "ready",
      emailSent: (sent?.n ?? 0) > 0,
    },
    { campaignId: c.id },
  );
  await db
    .insert(socialMessages)
    .values({ id: newId(), campaignId: c.id, companyId, channel: "facebook", message: message.trim() })
    .onConflictDoUpdate({ target: [socialMessages.companyId, socialMessages.channel], set: { message: message.trim(), updatedAt: new Date() } });
}

export type FacebookRow = {
  companyId: string;
  name: string;
  domain: string;
  score: number | null;
  location: string | null;
  facebookUrl: string | null;
  messengerUrl: string | null;
  instagramUrl: string | null;
  searched: boolean;
  sample: { id: string; video: boolean } | null;
  social: { id: string; message: string; status: SocialStatus; sentAt: Date | null } | null;
};

/** Messages envoyés à la main aujourd'hui (toutes campagnes du compte) : Facebook limite les comptes trop actifs. */
async function sentToday(owner: Owner): Promise<number> {
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(socialMessages)
    .where(and(inArray(socialMessages.campaignId, campaignIdsOf(owner)), isNotNull(socialMessages.sentAt), gte(socialMessages.sentAt, since)));
  return row?.n ?? 0;
}

/** Tableau de l'onglet Facebook : entreprises qualifiées, leur page, leur message et son état. */
export async function facebookBoard(campaignId: string, owner: Owner) {
  const db = await getDb();
  const rows = await db
    .select({ co: companies, social: socialMessages })
    .from(companies)
    .leftJoin(socialMessages, and(eq(socialMessages.companyId, companies.id), eq(socialMessages.channel, "facebook")))
    .where(and(eq(companies.campaignId, campaignId), eq(companies.status, "qualified")))
    .orderBy(desc(companies.score), asc(companies.name));
  const out: FacebookRow[] = [];
  for (const { co, social } of rows) {
    const sample = await sampleOf(co.id);
    out.push({
      companyId: co.id,
      name: co.name,
      domain: co.domain,
      score: co.score,
      location: co.location,
      facebookUrl: co.facebookUrl,
      messengerUrl: messengerUrl(co.facebookUrl),
      instagramUrl: co.instagramUrl,
      searched: !!co.socialsCheckedAt,
      sample: sample?.status === "ready" ? { id: sample.id, video: sample.video === "ready" } : null,
      social: social ? { id: social.id, message: social.message, status: social.status, sentAt: social.sentAt } : null,
    });
  }
  const count = (s: SocialStatus) => out.filter((r) => r.social?.status === s).length;
  return {
    rows: out,
    stats: {
      companies: out.length,
      withPage: out.filter((r) => r.facebookUrl).length,
      toSearch: out.filter((r) => !r.facebookUrl && !r.searched).length,
      toPrepare: out.filter((r) => r.facebookUrl && !r.social).length,
      todo: count("todo"),
      sent: count("sent"),
      replied: count("replied"),
      sentToday: await sentToday(owner),
    },
  };
}

/** Lance la recherche des pages manquantes et la rédaction des messages manquants. */
export async function prepareFacebook(campaignId: string): Promise<{ searching: number; writing: number }> {
  const db = await getDb();
  const qualified = and(eq(companies.campaignId, campaignId), eq(companies.status, "qualified"));
  const toSearch = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(qualified, isNull(companies.facebookUrl), isNull(companies.socialsCheckedAt)));
  const toWrite = await db
    .select({ id: companies.id })
    .from(companies)
    .leftJoin(socialMessages, and(eq(socialMessages.companyId, companies.id), eq(socialMessages.channel, "facebook")))
    .where(and(qualified, isNotNull(companies.facebookUrl), isNull(socialMessages.id)));
  for (const { id } of toSearch) await enqueue("company.socials", { companyId: id }, { campaignId, priority: 2 });
  for (const { id } of toWrite) await enqueue("social.write", { companyId: id }, { campaignId, priority: 2 });
  if (toSearch.length || toWrite.length) {
    await logEvent(
      campaignId,
      "info",
      "facebook",
      `📘 Facebook : ${toSearch.length} page(s) à rechercher, ${toWrite.length} message(s) à préparer.`,
    );
  }
  return { searching: toSearch.length, writing: toWrite.length };
}

/** Page Facebook saisie à la main (quand le site n'en donne pas). */
export async function setFacebookUrl(campaignId: string, companyId: string, url: string) {
  const page = normalizeFacebookUrl(url);
  if (!page) throw new PlanError("Ce lien n'est pas celui d'une page Facebook (ex. : https://www.facebook.com/nomdelapage).");
  const db = await getDb();
  const [co] = await db
    .update(companies)
    .set({ facebookUrl: page, socialsCheckedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(companies.id, companyId), eq(companies.campaignId, campaignId)))
    .returning({ id: companies.id });
  if (!co) throw new NotFoundError("Entreprise introuvable");
  await enqueue("social.write", { companyId }, { campaignId, priority: 1 });
  return page;
}

/** Réécrit le message d'une entreprise de la campagne (s'il n'est pas encore parti). */
export async function rewriteSocialMessage(campaignId: string, companyId: string) {
  const db = await getDb();
  const [co] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.campaignId, campaignId), isNotNull(companies.facebookUrl)));
  if (!co) throw new NotFoundError("Entreprise introuvable");
  await enqueue("social.write", { companyId }, { campaignId, priority: 1 });
}

async function ownedSocial(id: string, owner: Owner) {
  const db = await getDb();
  const [row] = await db
    .select({ social: socialMessages, userId: campaigns.userId, companyName: companies.name })
    .from(socialMessages)
    .innerJoin(campaigns, eq(campaigns.id, socialMessages.campaignId))
    .innerJoin(companies, eq(companies.id, socialMessages.companyId))
    .where(eq(socialMessages.id, id));
  if (!row || !canAccess(row.userId, owner)) throw new NotFoundError("Message introuvable");
  return row;
}

/**
 * Modifie un message Facebook (texte, état). « A répondu » arrête aussi les emails prévus pour cette entreprise :
 * la conversation continue sur Messenger.
 */
export async function updateSocialMessage(id: string, owner: Owner, patch: { message?: string; status?: SocialStatus }) {
  const { social, companyName } = await ownedSocial(id, owner);
  const db = await getDb();
  const now = new Date();
  const set: Partial<typeof socialMessages.$inferInsert> = { updatedAt: now };
  if (patch.message !== undefined) {
    const text = patch.message.trim();
    if (text.length < 5) throw new PlanError("Le message est trop court.");
    set.message = text.slice(0, 2000);
  }
  if (patch.status) {
    set.status = patch.status;
    if (patch.status === "sent" && !social.sentAt) set.sentAt = now;
    if (patch.status === "todo") set.sentAt = null;
  }
  const [updated] = await db.update(socialMessages).set(set).where(eq(socialMessages.id, id)).returning();

  if (patch.status === "replied" && social.status !== "replied") {
    const cts = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.companyId, social.companyId), inArray(contacts.status, ["drafted", "approved", "sent"])));
    for (const ct of cts) await setContactStatus(ct.id, "replied");
    await logEvent(social.campaignId, "success", "facebook", `📘 ${companyName} a répondu sur Facebook 🎉${cts.length ? " (emails suivants arrêtés)" : ""}.`);
  } else if (patch.status === "sent" && social.status === "todo") {
    await logEvent(social.campaignId, "info", "facebook", `📘 Message Facebook envoyé à ${companyName}.`);
  }
  return updated;
}
