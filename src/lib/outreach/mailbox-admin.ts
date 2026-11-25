import { ImapFlow } from "imapflow";
import { errorMessage } from "@/lib/util";
import type { SendingMailbox } from "./mailboxes";

/** Vue publique d'une boîte (sans mot de passe). */
export function publicMailbox(b: SendingMailbox, sentToday: number) {
  return {
    id: b.id,
    source: b.source,
    label: b.label,
    fromName: b.fromName,
    fromEmail: b.fromEmail,
    smtpHost: b.smtp.host,
    smtpPort: b.smtp.port,
    imapHost: b.imap?.host ?? null,
    dailyLimit: b.dailyLimit,
    enabled: b.enabled,
    sentToday,
    lastSyncAt: b.lastSyncAt,
    lastError: b.lastError,
  };
}

export async function testImap(mb: SendingMailbox): Promise<string | null> {
  if (!mb.imap) return null;
  const client = new ImapFlow({
    host: mb.imap.host,
    port: mb.imap.port,
    secure: mb.imap.secure,
    auth: { user: mb.imap.user, pass: mb.imap.pass },
    logger: false,
    socketTimeout: 20_000,
  });
  try {
    await client.connect();
    await client.logout();
    return null;
  } catch (e) {
    client.close();
    return errorMessage(e);
  }
}
