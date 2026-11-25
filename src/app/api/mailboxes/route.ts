import { z } from "zod";
import { handle, json } from "@/lib/api";
import { getDb } from "@/lib/db";
import { mailboxes } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { listMailboxes, sentTodayByMailbox, type SendingMailbox } from "@/lib/outreach/mailboxes";
import { publicMailbox, testImap } from "@/lib/outreach/mailbox-admin";
import { verifySmtp } from "@/lib/outreach/mailer";
import { errorMessage, newId } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return handle(async () => {
    const [boxes, sent] = await Promise.all([listMailboxes({ includeDisabled: true }), sentTodayByMailbox()]);
    return json({ mailboxes: boxes.map((b) => publicMailbox(b, sent.get(b.id) ?? 0)) });
  });
}

const Body = z.object({
  label: z.string().trim().default(""),
  fromName: z.string().trim().default(""),
  fromEmail: z.string().trim().toLowerCase().email(),
  smtpHost: z.string().trim().min(3),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpSecure: z.boolean().default(false),
  smtpUser: z.string().trim().min(1),
  smtpPass: z.string().min(1),
  imapHost: z.string().trim().default(""),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
  dailyLimit: z.number().int().min(1).max(500).default(40),
});

/** Ajoute une boîte après avoir vérifié la connexion SMTP (et IMAP si renseigné). */
export async function POST(req: Request) {
  return handle(async () => {
    const b = Body.parse(await req.json());
    const candidate: SendingMailbox = {
      id: "test",
      source: "db",
      label: b.label || b.fromEmail,
      fromName: b.fromName,
      fromEmail: b.fromEmail,
      smtp: { host: b.smtpHost, port: b.smtpPort, secure: b.smtpSecure, user: b.smtpUser, pass: b.smtpPass },
      imap: b.imapHost ? { host: b.imapHost, port: b.imapPort, secure: b.imapSecure, user: b.smtpUser, pass: b.smtpPass } : null,
      dailyLimit: b.dailyLimit,
      enabled: true,
      lastSyncAt: null,
      lastError: null,
    };
    try {
      await verifySmtp(candidate);
    } catch (e) {
      return json({ error: `Connexion SMTP impossible : ${errorMessage(e)}` }, 400);
    }
    if (candidate.imap) {
      const imapError = await testImap(candidate);
      if (imapError) return json({ error: `Connexion IMAP impossible : ${imapError}` }, 400);
    }
    const db = await getDb();
    const [row] = await db
      .insert(mailboxes)
      .values({
        id: newId(),
        label: candidate.label,
        fromName: b.fromName,
        fromEmail: b.fromEmail,
        smtpHost: b.smtpHost,
        smtpPort: b.smtpPort,
        smtpSecure: b.smtpSecure,
        smtpUser: b.smtpUser,
        smtpPassEnc: encryptSecret(b.smtpPass),
        imapHost: b.imapHost || null,
        imapPort: b.imapPort,
        imapSecure: b.imapSecure,
        dailyLimit: b.dailyLimit,
      })
      .returning({ id: mailboxes.id });
    return json({ id: row.id }, 201);
  });
}
