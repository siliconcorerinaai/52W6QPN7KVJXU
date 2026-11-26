import { z } from "zod";
import { handle, json } from "@/lib/api";
import { getDb } from "@/lib/db";
import { mailboxes } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { listMailboxes, sentTodayByMailbox, type SendingMailbox } from "@/lib/outreach/mailboxes";
import { explainSmtpError, publicMailbox, testImap } from "@/lib/outreach/mailbox-admin";
import { verifySmtp } from "@/lib/outreach/mailer";
import { assertPublicHost, MAIL_PORTS } from "@/lib/net-guard";
import { requireUser } from "@/lib/session";
import { errorMessage, newId } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_MAILBOXES = 20;

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const [boxes, sent] = await Promise.all([listMailboxes({ includeDisabled: true, owner: user }), sentTodayByMailbox()]);
    return json({ mailboxes: boxes.map((b) => publicMailbox(b, sent.get(b.id) ?? 0)) });
  });
}

const port = z.number().int().refine((p) => MAIL_PORTS.includes(p), { message: `Port non autorisé (ports acceptés : ${MAIL_PORTS.join(", ")})` });

const Body = z.object({
  label: z.string().trim().max(120).default(""),
  fromName: z.string().trim().max(120).default(""),
  fromEmail: z.string().trim().toLowerCase().email(),
  smtpHost: z.string().trim().min(3).max(253),
  smtpPort: port.default(587),
  smtpSecure: z.boolean().default(false),
  smtpUser: z.string().trim().min(1).max(320),
  smtpPass: z.string().min(1).max(500),
  imapHost: z.string().trim().max(253).default(""),
  imapPort: port.default(993),
  imapSecure: z.boolean().default(true),
  dailyLimit: z.number().int().min(1).max(500).default(40),
});

/** Ajoute une boîte au compte après avoir vérifié la connexion SMTP (et IMAP si renseigné). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const b = Body.parse(await req.json());
    const db = await getDb();
    const existing = await listMailboxes({ includeDisabled: true, owner: user });
    if (existing.filter((m) => m.source === "db").length >= MAX_MAILBOXES) {
      return json({ error: `Maximum ${MAX_MAILBOXES} boîtes d'envoi par compte.` }, 400);
    }
    try {
      await assertPublicHost(b.smtpHost);
      if (b.imapHost) await assertPublicHost(b.imapHost);
    } catch (e) {
      return json({ error: errorMessage(e) }, 400);
    }
    // Le mode TLS découle du port : 465 = TLS direct, 587 / 25 / 2525 = STARTTLS.
    if (b.smtpPort === 465) b.smtpSecure = true;
    else if ([587, 25, 2525].includes(b.smtpPort)) b.smtpSecure = false;
    const candidate: SendingMailbox = {
      id: "test",
      userId: user.id,
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
      return json({ error: `Connexion SMTP impossible : ${explainSmtpError(e, b.smtpPort, b.smtpSecure)}` }, 400);
    }
    if (candidate.imap) {
      const imapError = await testImap(candidate);
      if (imapError) return json({ error: `Connexion IMAP impossible : ${imapError}` }, 400);
    }
    const [row] = await db
      .insert(mailboxes)
      .values({
        id: newId(),
        userId: user.id,
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
