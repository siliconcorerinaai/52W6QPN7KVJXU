import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb, rowsOf } from "@/lib/db";
import { aiUsage, campaigns, companies, contacts, events, jobs, messages, type Campaign } from "@/lib/db/schema";
import { cancelCampaignJobs, enqueue } from "@/lib/jobs/queue";
import { logEvent } from "@/lib/events";
import { config } from "@/lib/config";
import { nextSendSlot } from "@/lib/outreach/mailer";
import { newId, normalizeDomain } from "@/lib/util";
import {
  CampaignOfferSchema,
  CampaignPlanSchema,
  CampaignSettingsSchema,
  type CampaignOffer,
  type CampaignPlan,
  type CampaignSettings,
} from "@/lib/types";

export type CampaignStats = {
  companies: number;
  analyzed: number;
  qualified: number;
  contacts: number;
  withEmail: number;
  verified: number;
  drafted: number;
  approved: number;
  sent: number;
  replied: number;
  costUsd: number;
  webSearches: number;
};

export async function createCampaign(input: {
  name?: string;
  prompt: string;
  plan: CampaignPlan;
  offer: Partial<CampaignOffer>;
  settings: Partial<CampaignSettings>;
}): Promise<Campaign> {
  const db = await getDb();
  const settings = CampaignSettingsSchema.parse(input.settings);
  settings.seedDomains = settings.seedDomains.map((d) => normalizeDomain(d)).filter((d): d is string => !!d);
  const [c] = await db
    .insert(campaigns)
    .values({
      id: newId(),
      name: input.name?.trim() || input.prompt.slice(0, 60),
      prompt: input.prompt.trim(),
      status: "running",
      plan: CampaignPlanSchema.parse(input.plan),
      offer: CampaignOfferSchema.parse(input.offer),
      settings,
    })
    .returning();
  await logEvent(c.id, "info", "start", `🚀 Campagne lancée — objectif : ${settings.targetCompanies} entreprises qualifiées, ${settings.contactsPerCompany} décideur(s) par entreprise.`);
  await enqueue("campaign.discover", { campaignId: c.id }, { campaignId: c.id, priority: 0 });
  await enqueue("campaign.supervise", { campaignId: c.id }, { campaignId: c.id, runAt: new Date(Date.now() + 5000) });
  return c;
}

export async function getCampaign(id: string) {
  const db = await getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return c ?? null;
}

async function ensureSupervisor(campaignId: string) {
  const db = await getDb();
  const res = await db.execute(
    sql`SELECT count(*)::int AS n FROM ${jobs} WHERE campaign_id = ${campaignId} AND type = 'campaign.supervise' AND status IN ('queued','running')`,
  );
  if (!Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0)) await enqueue("campaign.supervise", { campaignId }, { campaignId });
}

export async function updateCampaignStatus(id: string, action: "pause" | "resume" | "stop") {
  const db = await getDb();
  const c = await getCampaign(id);
  if (!c) throw new Error("Campagne introuvable");
  if (action === "pause") {
    await db.update(campaigns).set({ status: "paused", updatedAt: new Date() }).where(eq(campaigns.id, id));
    await logEvent(id, "warn", "pause", "⏸️ Campagne mise en pause (recherches et envois suspendus).");
  } else if (action === "resume") {
    await db.update(campaigns).set({ status: "running", updatedAt: new Date() }).where(eq(campaigns.id, id));
    await ensureSupervisor(id);
    await logEvent(id, "info", "resume", "▶️ Campagne relancée.");
  } else {
    await cancelCampaignJobs(id, ["campaign.discover", "company.research", "company.contacts", "contact.email", "contact.write", "campaign.supervise"]);
    await db.update(campaigns).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(campaigns.id, id));
    await logEvent(id, "warn", "stop", "⏹️ Recherche arrêtée manuellement. Les envois approuvés continuent.");
  }
}

/** « Trouver plus de leads » : augmente l'objectif et relance la découverte. */
export async function findMore(id: string, extra: number) {
  const db = await getDb();
  const c = await getCampaign(id);
  if (!c) throw new Error("Campagne introuvable");
  const [counts] = await db
    .select({ q: sql<number>`count(*) filter (where ${companies.status} = 'qualified')::int` })
    .from(companies)
    .where(eq(companies.campaignId, id));
  const settings = { ...c.settings, targetCompanies: Math.max(c.settings.targetCompanies, counts.q) + extra };
  await db
    .update(campaigns)
    .set({ settings, status: "running", emptyRounds: 0, discoveryRounds: 0, completedAt: null, updatedAt: new Date() })
    .where(eq(campaigns.id, id));
  await ensureSupervisor(id);
  await logEvent(id, "info", "more", `➕ Nouvel objectif : ${settings.targetCompanies} entreprises qualifiées.`);
}

export async function updateCampaignConfig(id: string, patch: { name?: string; offer?: Partial<CampaignOffer>; settings?: Partial<CampaignSettings> }) {
  const db = await getDb();
  const c = await getCampaign(id);
  if (!c) throw new Error("Campagne introuvable");
  await db
    .update(campaigns)
    .set({
      name: patch.name?.trim() || c.name,
      offer: patch.offer ? CampaignOfferSchema.parse({ ...c.offer, ...patch.offer }) : c.offer,
      settings: patch.settings ? CampaignSettingsSchema.parse({ ...c.settings, ...patch.settings }) : c.settings,
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, id));
}

export async function deleteCampaign(id: string) {
  const db = await getDb();
  await db.delete(campaigns).where(eq(campaigns.id, id));
}

export async function campaignStats(ids: string[]): Promise<Record<string, CampaignStats>> {
  const out: Record<string, CampaignStats> = {};
  if (!ids.length) return out;
  const db = await getDb();
  for (const id of ids)
    out[id] = { companies: 0, analyzed: 0, qualified: 0, contacts: 0, withEmail: 0, verified: 0, drafted: 0, approved: 0, sent: 0, replied: 0, costUsd: 0, webSearches: 0 };

  const co = await db
    .select({
      id: companies.campaignId,
      total: sql<number>`count(*)::int`,
      analyzed: sql<number>`count(*) filter (where ${companies.status} in ('qualified','disqualified','failed'))::int`,
      qualified: sql<number>`count(*) filter (where ${companies.status} = 'qualified')::int`,
    })
    .from(companies)
    .where(inArray(companies.campaignId, ids))
    .groupBy(companies.campaignId);
  for (const r of co) Object.assign(out[r.id], { companies: r.total, analyzed: r.analyzed, qualified: r.qualified });

  const ct = await db
    .select({
      id: contacts.campaignId,
      total: sql<number>`count(*)::int`,
      withEmail: sql<number>`count(*) filter (where ${contacts.emailStatus} in ('valid','risky','catch_all'))::int`,
      verified: sql<number>`count(*) filter (where ${contacts.emailStatus} = 'valid')::int`,
      drafted: sql<number>`count(*) filter (where ${contacts.status} in ('drafted','approved','sent','replied'))::int`,
      approved: sql<number>`count(*) filter (where ${contacts.status} in ('approved','sent','replied'))::int`,
      sent: sql<number>`count(*) filter (where ${contacts.status} in ('sent','replied'))::int`,
      replied: sql<number>`count(*) filter (where ${contacts.status} = 'replied')::int`,
    })
    .from(contacts)
    .where(inArray(contacts.campaignId, ids))
    .groupBy(contacts.campaignId);
  for (const r of ct) Object.assign(out[r.id], { contacts: r.total, withEmail: r.withEmail, verified: r.verified, drafted: r.drafted, approved: r.approved, sent: r.sent, replied: r.replied });

  const us = await db
    .select({ id: aiUsage.campaignId, cost: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float`, ws: sql<number>`coalesce(sum(${aiUsage.webSearches}),0)::int` })
    .from(aiUsage)
    .where(inArray(aiUsage.campaignId, ids))
    .groupBy(aiUsage.campaignId);
  for (const r of us) if (r.id) Object.assign(out[r.id], { costUsd: r.cost, webSearches: r.ws });
  return out;
}

export async function listCampaigns() {
  const db = await getDb();
  const rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
  const stats = await campaignStats(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, stats: stats[r.id] }));
}

export async function campaignEvents(campaignId: string, afterId = 0, limit = 200) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.campaignId, campaignId), gt(events.id, afterId)))
    .orderBy(desc(events.id))
    .limit(limit);
  return rows.reverse();
}

export async function listCompanies(campaignId: string) {
  const db = await getDb();
  const rows = await db.select().from(companies).where(eq(companies.campaignId, campaignId));
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
}

export async function listLeads(campaignId: string) {
  const db = await getDb();
  const rows = await db
    .select({
      contact: contacts,
      company: {
        id: companies.id,
        name: companies.name,
        domain: companies.domain,
        score: companies.score,
        industry: companies.industry,
        location: companies.location,
        country: companies.country,
        signals: companies.signals,
      },
    })
    .from(contacts)
    .innerJoin(companies, eq(companies.id, contacts.companyId))
    .where(eq(contacts.campaignId, campaignId));
  return rows.sort((a, b) => (b.company.score ?? 0) - (a.company.score ?? 0) || b.contact.relevance - a.contact.relevance);
}

export async function getContactDetail(contactId: string) {
  const db = await getDb();
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) return null;
  const [company] = await db.select().from(companies).where(eq(companies.id, contact.companyId));
  const msgs = await db.select().from(messages).where(eq(messages.contactId, contactId)).orderBy(messages.step);
  return { contact, company, messages: msgs };
}

/** Rédige (ou régénère) les séquences d'une liste de contacts. */
export async function requestWrite(contactIds: string[]) {
  const db = await getDb();
  const rows = await db.select().from(contacts).where(inArray(contacts.id, contactIds));
  let n = 0;
  for (const ct of rows) {
    if (!ct.email || ["sent", "replied", "unsubscribed", "bounced"].includes(ct.status)) continue;
    await enqueue("contact.write", { contactId: ct.id }, { campaignId: ct.campaignId, priority: 10 });
    n++;
  }
  return n;
}

/** Approuve les séquences : l'étape 1 part au prochain créneau, les relances suivent automatiquement. */
export async function approveContacts(contactIds: string[]) {
  const db = await getDb();
  const rows = await db.select().from(contacts).where(inArray(contacts.id, contactIds));
  let scheduled = 0;
  let offset = 0;
  for (const ct of rows) {
    if (ct.status !== "drafted" || !ct.email) continue;
    const msgs = await db.select().from(messages).where(eq(messages.contactId, ct.id)).orderBy(messages.step);
    const first = msgs.find((m) => m.step === 1 && m.status === "draft");
    if (!first) continue;
    // Étalement des envois (~2 à 4 min entre deux emails) pour préserver la délivrabilité
    const base = config.demoMode ? new Date(Date.now() + 2000 + offset * 1500) : nextSendSlot(new Date(Date.now() + offset * (120_000 + Math.random() * 120_000)));
    offset++;
    await db.update(messages).set({ status: "approved", scheduledAt: base, updatedAt: new Date() }).where(eq(messages.id, first.id));
    const others = msgs.filter((m) => m.step > 1 && m.status === "draft").map((m) => m.id);
    if (others.length) await db.update(messages).set({ status: "approved", updatedAt: new Date() }).where(inArray(messages.id, others));
    await db.update(contacts).set({ status: "approved", updatedAt: new Date() }).where(eq(contacts.id, ct.id));
    await enqueue("message.send", { messageId: first.id }, { campaignId: ct.campaignId, runAt: base, priority: 5 });
    scheduled++;
  }
  if (rows[0] && scheduled) {
    await logEvent(rows[0].campaignId, "info", "approve", `👍 ${scheduled} séquence(s) approuvée(s) et planifiée(s).`);
  }
  return scheduled;
}

/** Marque un contact (a répondu, désinscrit…) et annule ses relances. */
export async function setContactStatus(contactId: string, status: "replied" | "unsubscribed" | "bounced" | "drafted") {
  const db = await getDb();
  const [ct] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!ct) throw new Error("Contact introuvable");
  await db.update(contacts).set({ status, updatedAt: new Date() }).where(eq(contacts.id, contactId));
  if (status !== "drafted") {
    await db
      .update(messages)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(messages.contactId, contactId), inArray(messages.status, ["approved", "scheduled"])));
  } else {
    await db
      .update(messages)
      .set({ status: "draft", updatedAt: new Date() })
      .where(and(eq(messages.contactId, contactId), inArray(messages.status, ["approved", "scheduled", "cancelled"])));
  }
  const label = { replied: "a répondu 🎉", unsubscribed: "s'est désinscrit", bounced: "a rebondi", drafted: "remis en brouillon" }[status];
  await logEvent(ct.campaignId, status === "replied" ? "success" : "info", "contact", `${ct.fullName} ${label}.`, { contactId });
}

export async function updateContactEmail(contactId: string, email: string) {
  const db = await getDb();
  const [ct] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!ct) throw new Error("Contact introuvable");
  await db
    .update(contacts)
    .set({ email: email.trim().toLowerCase(), emailSource: "manual", emailStatus: "unknown", updatedAt: new Date() })
    .where(eq(contacts.id, contactId));
  await enqueue("contact.email", { contactId }, { campaignId: ct.campaignId, priority: 10 });
}

export async function updateMessage(messageId: string, patch: { subject?: string; body?: string }) {
  const db = await getDb();
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!m) throw new Error("Message introuvable");
  if (m.status === "sent") throw new Error("Message déjà envoyé");
  await db
    .update(messages)
    .set({ subject: patch.subject ?? m.subject, body: patch.body ?? m.body, updatedAt: new Date() })
    .where(eq(messages.id, messageId));
}

export async function globalStats() {
  const db = await getDb();
  const [c] = await db.select({ n: sql<number>`count(*)::int`, running: sql<number>`count(*) filter (where ${campaigns.status} = 'running')::int` }).from(campaigns);
  const [co] = await db.select({ q: sql<number>`count(*) filter (where ${companies.status} = 'qualified')::int`, all: sql<number>`count(*)::int` }).from(companies);
  const [ct] = await db
    .select({
      all: sql<number>`count(*)::int`,
      withEmail: sql<number>`count(*) filter (where ${contacts.emailStatus} in ('valid','risky','catch_all'))::int`,
      replied: sql<number>`count(*) filter (where ${contacts.status} = 'replied')::int`,
    })
    .from(contacts);
  const [m] = await db.select({ sent: sql<number>`count(*) filter (where ${messages.status} = 'sent')::int` }).from(messages);
  const [u] = await db.select({ cost: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float` }).from(aiUsage);
  return {
    campaigns: c.n,
    running: c.running,
    companies: co.all,
    qualified: co.q,
    contacts: ct.all,
    withEmail: ct.withEmail,
    replied: ct.replied,
    sent: m.sent,
    costUsd: u.cost,
  };
}
