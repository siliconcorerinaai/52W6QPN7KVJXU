/**
 * Lecture des boîtes de réception (IMAP) : détection des réponses et des rebonds.
 * - Réponse d'un prospect → contact « a répondu », relances annulées.
 * - Rebond (mailer-daemon, rapport de non-remise) → contact « rebond », email invalide.
 * - Réponses automatiques (absence, congés) → ignorées : les relances continuent.
 */
import { ImapFlow } from "imapflow";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contacts, messages, users } from "@/lib/db/schema";
import { campaignIdsOf, PLATFORM, type Owner } from "@/lib/ownership";
import { logEvent } from "@/lib/events";
import { errorMessage } from "@/lib/util";
import { listMailboxes, recordSync, type SendingMailbox } from "./mailboxes";

export type InboundMessage = {
  uid: number;
  from: string;
  subject: string;
  inReplyTo?: string | null;
  headers?: string;
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

async function fetchRecent(mb: SendingMailbox, since: Date): Promise<InboundMessage[]> {
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
            headers: msg.headers?.toString("utf8"),
          };
          out.push(item);
        }
        // Corps des rapports de non-remise (pour retrouver l'adresse en échec)
        for (const item of out) {
          if (classifyInbound(item).kind !== "bounce") continue;
          const full = await client.fetchOne(String(item.uid), { source: { start: 0, maxLength: 60_000 } }, { uid: true });
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
  const active = ["sent", "approved", "drafted"] as const;
  const inScope = owner ? sql`${contacts.campaignId} in ${campaignIdsOf(owner)}` : sql`true`;

  for (const item of items) {
    const c = classifyInbound(item, ownAddresses);
    if (c.kind === "reply") {
      // Par l'en-tête In-Reply-To (fiable), sinon par l'adresse de l'expéditeur
      let contactId: string | undefined;
      if (item.inReplyTo) {
        const [m] = await db.select({ contactId: messages.contactId }).from(messages).where(eq(messages.providerId, item.inReplyTo));
        contactId = m?.contactId;
      }
      const rows = contactId
        ? await db.select().from(contacts).where(and(eq(contacts.id, contactId), inScope))
        : await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.email, item.from.toLowerCase()), inArray(contacts.status, [...active]), inScope));
      for (const ct of rows) {
        if (!["sent", "approved", "drafted"].includes(ct.status)) continue;
        await markReplied(ct.id, ct.campaignId, ct.fullName, item.subject);
        replies++;
      }
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
      }
    }
  }
  return { replies, bounces };
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
      const items = await fetchRecent(mb, since);
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
