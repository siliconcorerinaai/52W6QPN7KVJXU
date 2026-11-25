/**
 * Boîtes d'envoi : la boîte « par défaut » des variables d'environnement (SMTP_*) et les boîtes
 * ajoutées depuis l'interface (mot de passe chiffré en base). Rotation automatique : chaque
 * séquence part de la boîte la moins chargée, ses relances restent dans la même boîte (même fil).
 */
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { appState, mailboxes, messages, type Mailbox } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const ENV_MAILBOX_ID = "env";

export type ServerConfig = { host: string; port: number; secure: boolean; user: string; pass: string };

export type SendingMailbox = {
  id: string;
  source: "env" | "db";
  label: string;
  fromName: string;
  fromEmail: string;
  smtp: ServerConfig;
  imap: ServerConfig | null;
  dailyLimit: number;
  enabled: boolean;
  lastSyncAt: Date | null;
  lastError: string | null;
};

function envMailbox(): SendingMailbox | null {
  if (!config.smtp.configured) return null;
  return {
    id: ENV_MAILBOX_ID,
    source: "env",
    label: "Boîte par défaut",
    fromName: config.smtp.senderName,
    fromEmail: config.smtp.senderEmail,
    smtp: { host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, user: config.smtp.user, pass: config.smtp.pass },
    imap: config.imap.host
      ? { host: config.imap.host, port: config.imap.port, secure: config.imap.secure, user: config.imap.user, pass: config.imap.pass }
      : null,
    dailyLimit: config.smtp.dailyLimit,
    enabled: true,
    lastSyncAt: null,
    lastError: null,
  };
}

export function toSendingMailbox(row: Mailbox): SendingMailbox {
  const pass = decryptSecret(row.smtpPassEnc);
  return {
    id: row.id,
    source: "db",
    label: row.label,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    smtp: { host: row.smtpHost, port: row.smtpPort, secure: row.smtpSecure, user: row.smtpUser, pass },
    imap: row.imapHost ? { host: row.imapHost, port: row.imapPort, secure: row.imapSecure, user: row.smtpUser, pass } : null,
    dailyLimit: row.dailyLimit,
    enabled: row.enabled,
    lastSyncAt: row.lastSyncAt,
    lastError: row.lastError,
  };
}

/** Toutes les boîtes utilisables (mots de passe déchiffrés). Les boîtes indéchiffrables sont ignorées. */
export async function listMailboxes({ includeDisabled = false } = {}): Promise<SendingMailbox[]> {
  const db = await getDb();
  const out: SendingMailbox[] = [];
  const env = envMailbox();
  if (env) {
    const [state] = await db.select().from(appState).where(eq(appState.key, `mailbox:${ENV_MAILBOX_ID}`));
    const v = (state?.value ?? {}) as { lastSyncAt?: string; lastError?: string | null };
    out.push({ ...env, lastSyncAt: v.lastSyncAt ? new Date(v.lastSyncAt) : null, lastError: v.lastError ?? null });
  }
  for (const row of await db.select().from(mailboxes).orderBy(mailboxes.createdAt)) {
    if (!includeDisabled && !row.enabled) continue;
    try {
      out.push(toSendingMailbox(row));
    } catch (e) {
      console.error(`[mailboxes] ${row.label} : mot de passe illisible (clé de chiffrement changée ?)`, e);
    }
  }
  return out;
}

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Emails envoyés aujourd'hui, par boîte (les envois antérieurs aux boîtes multiples comptent pour « env »). */
export async function sentTodayByMailbox(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({ id: sql<string>`coalesce(${messages.mailboxId}, ${ENV_MAILBOX_ID})`, n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.status, "sent"), isNotNull(messages.sentAt), gte(messages.sentAt, startOfDay())))
    .groupBy(sql`1`);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * Choisit la boîte d'envoi. `preferredId` (relance) : la même boîte que le premier email ;
 * si elle a atteint sa limite, on attend demain plutôt que de casser le fil.
 * Renvoie `null` si aucune boîte n'a de capacité aujourd'hui, et lève une erreur s'il n'y a aucune boîte.
 */
export async function pickMailbox(preferredId?: string | null): Promise<SendingMailbox | null> {
  const boxes = (await listMailboxes()).filter((b) => b.enabled);
  if (!boxes.length) throw new NoMailboxError("Aucune boîte d'envoi configurée (Paramètres → Boîtes d'envoi).");
  const sent = await sentTodayByMailbox();
  const remaining = (b: SendingMailbox) => b.dailyLimit - (sent.get(b.id) ?? 0);

  if (preferredId) {
    const preferred = boxes.find((b) => b.id === preferredId);
    if (preferred) return remaining(preferred) > 0 ? preferred : null;
  }
  const available = boxes.filter((b) => remaining(b) > 0);
  if (!available.length) return null;
  const best = Math.max(...available.map(remaining));
  const candidates = available.filter((b) => remaining(b) === best);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export class NoMailboxError extends Error {
  override name = "NoMailboxError";
}

export async function getMailbox(id: string): Promise<SendingMailbox | null> {
  return (await listMailboxes({ includeDisabled: true })).find((b) => b.id === id) ?? null;
}

/** Enregistre l'état de synchronisation IMAP d'une boîte. */
export async function recordSync(id: string, lastError: string | null) {
  const db = await getDb();
  const now = new Date();
  if (id === ENV_MAILBOX_ID) {
    const value = { lastSyncAt: now.toISOString(), lastError };
    await db
      .insert(appState)
      .values({ key: `mailbox:${id}`, value })
      .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: now } });
  } else {
    await db.update(mailboxes).set({ lastSyncAt: now, lastError, updatedAt: now }).where(eq(mailboxes.id, id));
  }
}
