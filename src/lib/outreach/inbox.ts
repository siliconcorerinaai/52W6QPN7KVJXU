/**
 * Lecture des boîtes de réception (IMAP) : détection des réponses et des rebonds.
 * - Réponse d'un prospect → contact « a répondu », relances annulées.
 * - Rebond (mailer-daemon, rapport de non-remise) → contact « rebond », email invalide.
 * - Réponses automatiques (absence, congés) → ignorées : les relances continuent.
 */
import { ImapFlow } from "imapflow";
import { and, desc, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contacts, messages, replies, users, type Contact } from "@/lib/db/schema";
import { enqueue } from "@/lib/jobs/queue";
import { parseReply } from "./reply-text";
import { campaignIdsOf, PLATFORM, type Owner } from "@/lib/ownership";
import { logEvent } from "@/lib/events";
import { errorMessage, hashString, newId } from "@/lib/util";
import { listMailboxes, recordSync, type SendingMailbox } from "./mailboxes";
import { checkBounceBreaker } from "@/lib/pipeline/safety";

export type InboundMessage = {
  uid: number;
  from: string;
  subject: string;
  inReplyTo?: string | null;
  /** Message-ID de l'email reçu (identifiant de la réponse, pour ne pas la stocker deux fois). */
  messageId?: string | null;
  date?: Date | null;
  headers?: string;
  /** Source brute (MIME) : rapports de non-remise et réponses des prospects. */
  body?: string;
};

export type Classification = {
  kind: "reply" | "bounce" | "auto" | "other";
  bounced: string[];
  /** Identifiants (Message-ID) cités dans un rapport de non-remise : ceux des emails en échec. */
  messageIds?: string[];
};

const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|bounce[s]?|noreply-dmarc)[@+]/i;
const BOUNCE_SUBJECT =
  /(undeliver|delivery status notification|delivery has failed|failure notice|returned mail|mail delivery failed|non remis|non distribu|échec de la remise|echec de la remise|could not be delivered|address not found)/i;
const AUTO_SUBJECT =
  /^(r[ée]ponse automatique|automatic reply|auto(matic)?[ -]?reply|autoreply|out of (the )?office|absent|absence|en cong[ée]s?|abwesenheit|fuera de la oficina)/i;
const AUTO_HEADERS = /^(auto-submitted:\s*auto-(replied|generated)|x-autoreply:|x-autorespond:|precedence:\s*(auto_reply|bulk|junk))/im;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const MESSAGE_ID_RE = /<[^<>\s"]+@[^<>\s"]+>/g;
/**
 * Échec définitif, ou seulement temporaire (le serveur réessaie). Cherché dans le texte du rapport
 * uniquement (pas dans les en-têtes, où des adresses IP ressemblent à des codes).
 */
const PERMANENT = /permanent|^action:\s*failed|error code\s*:?\s*5\d\d|\b5\d\d[ -]+5\.\d{1,3}\.\d{1,3}\b/im;
const TEMPORARY = /^action:\s*delayed|\bdelayed\b|temporar(?:y|ily)\s+(?:failure|error|problem|unavailable)|will (?:be )?retr|still trying/im;

/**
 * Texte lisible d'un message brut : les parties encodées (base64, quoted-printable) sont décodées,
 * car beaucoup de rapports de non-remise (Zoho, Outlook…) encodent l'adresse en échec.
 */
export function readableText(raw: string): string {
  const out = [raw];
  for (const m of raw.matchAll(/content-transfer-encoding:\s*base64[^\n]*\n(?:[^\n]*\S[^\n]*\n)*?\r?\n([A-Za-z0-9+/=\r\n]+)/gi)) {
    try {
      out.push(Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8"));
    } catch {
      /* partie illisible */
    }
  }
  if (/quoted-printable/i.test(raw)) {
    out.push(raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
  }
  return out.join("\n");
}

/** Classe un message entrant (fonction pure, testée). */
export function classifyInbound(m: InboundMessage, ownAddresses: string[] = []): Classification {
  const from = m.from.toLowerCase();
  const subject = m.subject ?? "";
  if (ownAddresses.some((a) => a.toLowerCase() === from)) return { kind: "other", bounced: [] };
  if (BOUNCE_SENDER.test(from) || BOUNCE_SUBJECT.test(subject)) {
    const body = readableText(m.body ?? "");
    const text = `${m.headers ?? ""}\n${body}`;
    // Simple retard de remise : le serveur réessaie, ce n'est pas (encore) un rebond.
    if (body && TEMPORARY.test(body) && !PERMANENT.test(body)) return { kind: "auto", bounced: [] };
    const explicit = [...text.matchAll(/(?:final|original)-recipient:\s*rfc822;\s*<?([^\s>;]+)/gi)].map((x) => x[1].toLowerCase());
    const fallback = explicit.length ? [] : (text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase());
    const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
    const bounced = [...new Set([...explicit, ...fallback])].filter((e) => !own.has(e) && !BOUNCE_SENDER.test(e));
    const messageIds = [...new Set(text.match(MESSAGE_ID_RE) ?? [])];
    return { kind: "bounce", bounced, messageIds };
  }
  if (AUTO_SUBJECT.test(subject.trim()) || AUTO_HEADERS.test(m.headers ?? "")) return { kind: "auto", bounced: [] };
  return { kind: "reply", bounced: [] };
}

type SyncResult = { scanned: number; replies: number; bounces: number };

/**
 * Lit les messages récents. Le contenu complet n'est téléchargé que pour les rapports de non-remise
 * et pour les réponses que `wantBody` désigne (prospects connus, pas encore enregistrées).
 */
async function fetchRecent(
  mb: SendingMailbox,
  since: Date,
  wantBody: (items: InboundMessage[]) => Promise<Set<number>> = async () => new Set(),
): Promise<InboundMessage[]> {
  const imap = mb.imap!;
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
    socketTimeout: 60_000,
  });
  await client.connect();
  const out: InboundMessage[] = [];
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      const recent = uids.slice(-300);
      if (recent.length) {
        for await (const msg of client.fetch(recent, { uid: true, envelope: true, headers: true }, { uid: true })) {
          const from = msg.envelope?.from?.[0]?.address ?? "";
          const subject = msg.envelope?.subject ?? "";
          const item: InboundMessage = {
            uid: msg.uid,
            from,
            subject,
            inReplyTo: msg.envelope?.inReplyTo ?? null,
            messageId: msg.envelope?.messageId ?? null,
            date: msg.envelope?.date ? new Date(msg.envelope.date) : null,
            headers: msg.headers?.toString("utf8"),
          };
          out.push(item);
        }
        // Contenu complet : rapports de non-remise (adresse en échec) et nouvelles réponses de prospects
        const replyUids = await wantBody(out);
        for (const item of out) {
          if (classifyInbound(item).kind !== "bounce" && !replyUids.has(item.uid)) continue;
          const full = await client.fetchOne(String(item.uid), { source: { start: 0, maxLength: 200_000 } }, { uid: true });
          if (full && full.source) item.body = full.source.toString("utf8");
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return out;
}

/**
 * Applique les réponses et rebonds détectés à la base. Avec `owner`, seuls les contacts des campagnes
 * de ce compte sont concernés (une boîte ne touche jamais aux prospects d'un autre client).
 */
export async function applyInbound(items: InboundMessage[], ownAddresses: string[], owner?: Owner): Promise<Omit<SyncResult, "scanned">> {
  const db = await getDb();
  let replies = 0;
  let bounces = 0;
  const bouncedCampaigns = new Set<string>();
  const active = ["sent", "approved", "drafted"] as const;
  const inScope = owner ? sql`${contacts.campaignId} in ${campaignIdsOf(owner)}` : sql`true`;

  for (const item of items) {
    const c = classifyInbound(item, ownAddresses);
    if (c.kind === "reply") {
      const ct = await contactForReply(item, inScope);
      if (!ct) continue;
      if ((active as readonly string[]).includes(ct.status)) {
        await markReplied(ct.id, ct.campaignId, ct.fullName, item.subject);
        replies++;
      }
      await storeReply(item, ct);
    } else if (c.kind === "bounce" && (c.bounced.length || c.messageIds?.length)) {
      // L'email en échec, retrouvé par son identifiant (sûr), sinon par l'adresse citée dans le rapport.
      const byId = c.messageIds?.length
        ? (await db.select({ contactId: messages.contactId }).from(messages).where(inArray(messages.providerId, c.messageIds))).map((r) => r.contactId)
        : [];
      const match = [
        byId.length ? inArray(contacts.id, byId) : undefined,
        c.bounced.length ? inArray(contacts.email, c.bounced) : undefined,
      ].filter((x) => x !== undefined);
      const rows = await db
        .select()
        .from(contacts)
        .where(and(or(...match), inArray(contacts.status, [...active]), inScope));
      for (const ct of rows) {
        await db.update(contacts).set({ status: "bounced", emailStatus: "invalid", updatedAt: new Date() }).where(eq(contacts.id, ct.id));
        await db
          .update(messages)
          .set({ status: "cancelled", error: "Rebond", updatedAt: new Date() })
          .where(and(eq(messages.contactId, ct.id), inArray(messages.status, ["approved", "scheduled"])));
        await logEvent(ct.campaignId, "error", "bounce", `↩️ Rebond pour ${ct.fullName} <${ct.email}> : adresse marquée invalide, relances annulées.`, {
          contactId: ct.id,
        });
        bounces++;
        bouncedCampaigns.add(ct.campaignId);
      }
    }
  }
  // Coupe-circuit : trop de rebonds → règle d'envoi resserrée (ou campagne en pause).
  for (const id of bouncedCampaigns) await checkBounceBreaker(id);
  return { replies, bounces };
}

/**
 * Le prospect qui répond : par l'en-tête In-Reply-To (nos emails de séquence, ou nos réponses
 * envoyées depuis la boîte de réception), sinon par son adresse (le plus récent).
 */
async function contactForReply(item: InboundMessage, inScope: SQL): Promise<Contact | null> {
  const db = await getDb();
  if (item.inReplyTo) {
    const [m] = await db.select({ contactId: messages.contactId }).from(messages).where(eq(messages.providerId, item.inReplyTo));
    const [r] = m ? [undefined] : await db.select({ contactId: replies.contactId }).from(replies).where(eq(replies.messageId, item.inReplyTo));
    const id = m?.contactId ?? r?.contactId;
    if (id) {
      const [ct] = await db.select().from(contacts).where(and(eq(contacts.id, id), inScope));
      if (ct) return ct;
    }
  }
  const [ct] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.email, item.from.toLowerCase()), notInArray(contacts.status, ["bounced"]), inScope))
    .orderBy(desc(contacts.updatedAt))
    .limit(1);
  return ct ?? null;
}

/** Identifiant stable d'une réponse : son Message-ID, sinon une empreinte (pour rester idempotent). */
function replyKey(item: InboundMessage): string {
  if (item.messageId) return item.messageId;
  return `<sans-id-${hashString(`${item.from}|${item.subject}|${item.date?.toISOString() ?? ""}`)}@ciblora>`;
}

/** Enregistre la réponse (texte lisible) et demande à l'IA de la classer et de préparer un brouillon. */
async function storeReply(item: InboundMessage, ct: Contact) {
  const db = await getDb();
  const parsed = item.body ? await parseReply(item.body).catch(() => null) : null;
  const [row] = await db
    .insert(replies)
    .values({
      id: newId(),
      campaignId: ct.campaignId,
      contactId: ct.id,
      direction: "in",
      messageId: item.messageId ?? parsed?.messageId ?? replyKey(item),
      inReplyTo: item.inReplyTo ?? parsed?.inReplyTo ?? null,
      fromEmail: item.from.toLowerCase(),
      subject: item.subject ?? "",
      body: parsed?.text ?? "",
      receivedAt: item.date ?? parsed?.date ?? new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: replies.id });
  if (row) await enqueue("reply.triage", { replyId: row.id }, { campaignId: ct.campaignId, priority: 1 });
}

/** Parmi les messages reçus, les réponses de prospects connus pas encore enregistrées (à télécharger). */
export async function newProspectReplies(items: InboundMessage[], own: string[]): Promise<Set<number>> {
  const candidates = items.filter((i) => classifyInbound(i, own).kind === "reply");
  if (!candidates.length) return new Set();
  const db = await getDb();
  const froms = [...new Set(candidates.map((i) => i.from.toLowerCase()))];
  const threads = [...new Set(candidates.map((i) => i.inReplyTo).filter((x): x is string => !!x))];
  const knownFrom = new Set((await db.select({ email: contacts.email }).from(contacts).where(inArray(contacts.email, froms))).map((r) => r.email));
  const knownThread = threads.length
    ? new Set(
        [
          ...(await db.select({ id: messages.providerId }).from(messages).where(inArray(messages.providerId, threads))),
          ...(await db.select({ id: replies.messageId }).from(replies).where(inArray(replies.messageId, threads))),
        ].map((r) => r.id),
      )
    : new Set<string | null>();
  const keys = candidates.map(replyKey);
  const stored = new Set((await db.select({ m: replies.messageId }).from(replies).where(inArray(replies.messageId, keys))).map((r) => r.m));
  return new Set(
    candidates
      .filter((i) => (knownFrom.has(i.from.toLowerCase()) || (i.inReplyTo && knownThread.has(i.inReplyTo))) && !stored.has(replyKey(i)))
      .map((i) => i.uid),
  );
}

async function markReplied(contactId: string, campaignId: string, name: string, subject: string) {
  const db = await getDb();
  const now = new Date();
  await db.update(contacts).set({ status: "replied", repliedAt: now, updatedAt: now }).where(eq(contacts.id, contactId));
  await db
    .update(messages)
    .set({ status: "cancelled", error: "Le prospect a répondu", updatedAt: now })
    .where(and(eq(messages.contactId, contactId), inArray(messages.status, ["approved", "scheduled"])));
  await logEvent(campaignId, "success", "reply", `📬 ${name} a répondu${subject ? ` : « ${subject.slice(0, 80)} »` : ""} — relances arrêtées.`, {
    contactId,
  });
}

async function mailboxOwner(mb: SendingMailbox): Promise<Owner> {
  if (!mb.userId) return PLATFORM;
  const db = await getDb();
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, mb.userId));
  return { id: mb.userId, role: u?.role ?? "user" };
}

/** Synchronise toutes les boîtes ayant un accès IMAP. */
export async function syncAllInboxes(): Promise<SyncResult & { mailboxes: number; errors: string[] }> {
  const boxes = (await listMailboxes()).filter((b) => b.imap);
  const own = boxes.map((b) => b.fromEmail);
  const total = { scanned: 0, replies: 0, bounces: 0, mailboxes: boxes.length, errors: [] as string[] };
  for (const mb of boxes) {
    try {
      // IMAP filtre au jour près : on relit les 3 derniers jours (le traitement est idempotent)
      const since = new Date(Date.now() - 3 * 86_400_000);
      const items = await fetchRecent(mb, since, (found) => newProspectReplies(found, own));
      const r = await applyInbound(items, own, await mailboxOwner(mb));
      total.scanned += items.length;
      total.replies += r.replies;
      total.bounces += r.bounces;
      await recordSync(mb.id, null);
    } catch (e) {
      const msg = errorMessage(e);
      total.errors.push(`${mb.fromEmail} : ${msg}`);
      await recordSync(mb.id, msg.slice(0, 500));
      console.error(`[inbox] ${mb.fromEmail}`, msg);
    }
  }
  return total;
}
