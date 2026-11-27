/**
 * Boîte de réception : les réponses des prospects, classées par l'IA, avec un brouillon de réponse
 * à envoyer dans la même conversation ; reprise des relances quand une « réponse » n'en était pas une.
 */
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { intelligence } from "@/lib/ai";
import type { ThreadItem } from "@/lib/ai/intelligence";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { campaigns, companies, contacts, messages, replies, suppressions, type Reply, type ReplyCategory } from "@/lib/db/schema";
import { logEvent } from "@/lib/events";
import { enqueue } from "@/lib/jobs/queue";
import { getMailbox, listMailboxes } from "@/lib/outreach/mailboxes";
import { nextSendSlot, sendEmail, timeZoneFor } from "@/lib/outreach/mailer";
import { getSenderAddress } from "@/lib/outreach/sender";
import { campaignIdsOf, campaignOwner, canAccess, NotFoundError, type Owner } from "@/lib/ownership";
import { newId } from "@/lib/util";
import { PlanError, setContactStatus } from "./campaigns";

export const CATEGORY_LABEL: Record<ReplyCategory, string> = {
  interested: "intéressé",
  question: "question",
  not_now: "pas maintenant",
  not_interested: "pas intéressé",
  unsubscribe: "désinscription",
  auto: "réponse automatique",
  other: "autre",
};

/** Le fil avec un prospect : nos emails envoyés et les réponses, du plus ancien au plus récent. */
export async function threadOf(contactId: string): Promise<(ThreadItem & { id: string; kind: "sequence" | "reply" })[]> {
  const db = await getDb();
  const sent = await db
    .select()
    .from(messages)
    .where(and(eq(messages.contactId, contactId), eq(messages.status, "sent")));
  const rs = await db.select().from(replies).where(eq(replies.contactId, contactId));
  return [
    ...sent.map((m) => ({ id: m.id, kind: "sequence" as const, from: "us" as const, subject: m.subject, body: m.body, at: m.sentAt ?? m.updatedAt })),
    ...rs.map((r) => ({
      id: r.id,
      kind: "reply" as const,
      from: r.direction === "in" ? ("prospect" as const) : ("us" as const),
      subject: r.subject,
      body: r.body,
      at: r.receivedAt,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Classe une réponse entrante, prépare le brouillon et applique les conséquences (désinscription, absence). */
export async function triageReply(replyId: string) {
  const db = await getDb();
  const [r] = await db.select().from(replies).where(eq(replies.id, replyId));
  if (!r || r.direction !== "in") return;
  const [ct] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, r.campaignId));
  if (!ct || !c) return;
  const [co] = await db.select().from(companies).where(eq(companies.id, ct.companyId));
  if (!co) return;

  const thread = await threadOf(ct.id);
  const t = await intelligence().triageReply({ offer: c.offer, company: co, contact: ct, thread }, { campaignId: c.id });
  await db
    .update(replies)
    .set({
      category: t.category,
      summary: t.summary.slice(0, 500),
      draftSubject: t.needsReply ? t.subject : null,
      draftBody: t.needsReply ? t.body : null,
      // Rien à répondre (désinscription, réponse automatique) : déjà traitée.
      status: t.needsReply && r.status === "new" ? "new" : r.status === "answered" ? "answered" : t.needsReply ? r.status : "handled",
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(replies.id, r.id));

  if (t.category === "unsubscribe" && ct.email) {
    await db.insert(suppressions).values({ userId: c.userId ?? "", value: ct.email.toLowerCase(), reason: "unsubscribe" }).onConflictDoNothing();
    if (ct.status !== "unsubscribed") await setContactStatus(ct.id, "unsubscribed");
  } else if (t.category === "auto" && ct.status === "replied") {
    // Une réponse automatique n'est pas une vraie réponse : les relances reprennent.
    await resumeFollowUps(ct.id);
  }
  await logEvent(c.id, t.category === "interested" ? "success" : "info", "reply", `💬 ${ct.fullName} (${co.name}) : ${CATEGORY_LABEL[t.category]} — ${t.summary}`, {
    contactId: ct.id,
    replyId: r.id,
  });
}

/**
 * Relances reprises pour un contact marqué « a répondu » à tort (réponse automatique, erreur de clic) :
 * les emails annulés après le dernier envoyé repartent, le prochain est planifié.
 */
export async function resumeFollowUps(contactId: string): Promise<number> {
  const db = await getDb();
  const [ct] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!ct) throw new NotFoundError("Contact introuvable");
  if (ct.status !== "replied") throw new PlanError("Seuls les contacts marqués « a répondu » peuvent reprendre leurs relances.");
  const all = await db.select().from(messages).where(eq(messages.contactId, contactId)).orderBy(asc(messages.step));
  const lastSent = all.filter((m) => m.status === "sent").at(-1);
  if (!lastSent) {
    await setContactStatus(contactId, "drafted");
    return 0;
  }
  const pending = all.filter((m) => m.step > lastSent.step && m.status === "cancelled");
  await db.update(contacts).set({ status: "sent", repliedAt: null, updatedAt: new Date() }).where(eq(contacts.id, contactId));
  if (!pending.length) return 0;

  await db
    .update(messages)
    .set({ status: "approved", error: null, updatedAt: new Date() })
    .where(inArray(messages.id, pending.map((m) => m.id)));
  const next = pending[0];
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, ct.campaignId));
  const [co] = await db.select().from(companies).where(eq(companies.id, ct.companyId));
  const timeZone = timeZoneFor(co?.country) ?? timeZoneFor(c?.plan.geographies[0]);
  const due = new Date(Math.max(Date.now(), (lastSent.sentAt ?? new Date()).getTime() + (next.delayDays || 3) * 86_400_000));
  const at = config.demoMode ? new Date(Date.now() + 2000) : nextSendSlot(due, timeZone);
  await db.update(messages).set({ status: "scheduled", scheduledAt: at, updatedAt: new Date() }).where(eq(messages.id, next.id));
  await enqueue("message.send", { messageId: next.id }, { campaignId: ct.campaignId, runAt: at, priority: 5 });
  await logEvent(ct.campaignId, "info", "contact", `🔁 Relances reprises pour ${ct.fullName} : prochain email le ${at.toISOString().slice(0, 10)}.`, {
    contactId,
  });
  return pending.length;
}

export type ReplyFilter = "todo" | "interested" | "question" | "not_now" | "all";

/** Réponses reçues (les plus récentes d'abord), limitées aux campagnes du compte. */
export async function listReplies(owner: Owner, filter: ReplyFilter = "todo") {
  const db = await getDb();
  const where = [eq(replies.direction, "in"), sql`${replies.campaignId} in ${campaignIdsOf(owner)}`];
  if (filter === "todo") where.push(eq(replies.status, "new"));
  else if (filter !== "all") where.push(eq(replies.category, filter));
  return db
    .select({
      id: replies.id,
      category: replies.category,
      status: replies.status,
      summary: replies.summary,
      subject: replies.subject,
      snippet: sql<string>`left(${replies.body}, 160)`,
      receivedAt: replies.receivedAt,
      contactId: contacts.id,
      contactName: contacts.fullName,
      contactTitle: contacts.title,
      companyName: companies.name,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
    })
    .from(replies)
    .innerJoin(contacts, eq(contacts.id, replies.contactId))
    .innerJoin(companies, eq(companies.id, contacts.companyId))
    .innerJoin(campaigns, eq(campaigns.id, replies.campaignId))
    .where(and(...where))
    .orderBy(desc(replies.receivedAt))
    .limit(200);
}

/** Nombre de réponses à traiter (pastille du menu). */
export async function countNewReplies(owner: Owner): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(replies)
    .where(and(eq(replies.direction, "in"), eq(replies.status, "new"), sql`${replies.campaignId} in ${campaignIdsOf(owner)}`));
  return row?.n ?? 0;
}

export async function getOwnedReply(id: string, owner: Owner): Promise<Reply> {
  const db = await getDb();
  const [row] = await db
    .select({ reply: replies, ownerId: campaigns.userId })
    .from(replies)
    .innerJoin(campaigns, eq(campaigns.id, replies.campaignId))
    .where(eq(replies.id, id));
  if (!row || !canAccess(row.ownerId, owner)) throw new NotFoundError("Réponse introuvable");
  return row.reply;
}

/** Une réponse avec tout son contexte : prospect, entreprise, campagne et fil complet. */
export async function getReplyDetail(id: string, owner: Owner) {
  const r = await getOwnedReply(id, owner);
  const db = await getDb();
  const [ct] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
  const [co] = await db.select({ id: companies.id, name: companies.name, domain: companies.domain }).from(companies).where(eq(companies.id, ct.companyId));
  const [c] = await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(eq(campaigns.id, r.campaignId));
  return {
    reply: r,
    contact: { id: ct.id, fullName: ct.fullName, title: ct.title, email: ct.email, status: ct.status },
    company: co,
    campaign: c,
    thread: await threadOf(ct.id),
  };
}

export async function setReplyStatus(id: string, owner: Owner, status: "new" | "handled") {
  await getOwnedReply(id, owner);
  const db = await getDb();
  await db.update(replies).set({ status, updatedAt: new Date() }).where(eq(replies.id, id));
}

/** Envoie notre réponse dans la même conversation (même boîte, en-têtes In-Reply-To). */
export async function sendReply(id: string, owner: Owner, input: { subject: string; body: string }) {
  const r = await getOwnedReply(id, owner);
  if (r.direction !== "in") throw new PlanError("On ne répond qu'à un message reçu.");
  const db = await getDb();
  const [ct] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, r.campaignId));
  const [co] = await db.select({ language: companies.language }).from(companies).where(eq(companies.id, ct.companyId));
  const to = r.fromEmail || ct.email;
  if (!to) throw new PlanError("Adresse du prospect inconnue.");

  let providerId: string;
  let mailboxId: string | null = null;
  let fromEmail = "";
  if (config.demoMode) {
    providerId = `<demo-${newId()}@ciblora>`;
  } else {
    const campOwner = await campaignOwner(c.id);
    const [first] = await db
      .select({ mailboxId: messages.mailboxId })
      .from(messages)
      .where(and(eq(messages.contactId, ct.id), eq(messages.status, "sent")))
      .orderBy(asc(messages.step))
      .limit(1);
    const mailbox =
      (first?.mailboxId ? await getMailbox(first.mailboxId, campOwner) : null) ??
      (await listMailboxes({ owner: campOwner })).find((b) => b.enabled) ??
      null;
    if (!mailbox) throw new PlanError("Aucune boîte d'envoi configurée (Paramètres → Boîtes d'envoi).");
    if (!(await getSenderAddress(mailbox.userId))) throw new PlanError("Renseignez votre adresse postale dans Paramètres avant d'envoyer.");
    const language = c.offer.language && c.offer.language !== "auto" ? c.offer.language : (co?.language ?? null);
    const res = await sendEmail(
      { to, toName: ct.fullName, subject: input.subject, body: input.body, contactId: ct.id, inReplyTo: r.messageId, language },
      mailbox,
    );
    providerId = res.messageId;
    mailboxId = mailbox.id;
    fromEmail = mailbox.fromEmail;
  }

  const now = new Date();
  await db.insert(replies).values({
    id: newId(),
    campaignId: r.campaignId,
    contactId: r.contactId,
    mailboxId,
    direction: "out",
    messageId: providerId,
    inReplyTo: r.messageId,
    fromEmail,
    subject: input.subject,
    body: input.body,
    receivedAt: now,
    status: "answered",
  });
  await db.update(replies).set({ status: "answered", updatedAt: now }).where(eq(replies.id, r.id));
  await logEvent(r.campaignId, "success", "reply", `📤 Réponse envoyée à ${ct.fullName}.`, { contactId: ct.id, replyId: r.id });
}

/** Contacts dont la conversation est récente : la boîte de réception continue d'être lue pour eux. */
export async function recentConversations(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.status, "replied"), gt(contacts.updatedAt, new Date(Date.now() - 14 * 86_400_000))));
  return row?.n ?? 0;
}
