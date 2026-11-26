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
    return explainImapError(e);
  }
}

/** Message IMAP compréhensible : la raison donnée par le serveur plutôt qu'un « Command failed » générique. */
export function explainImapError(e: unknown): string {
  const err = (e ?? {}) as { authenticationFailed?: boolean; responseText?: string; serverResponseCode?: string; code?: string };
  const detail = [err.serverResponseCode, err.responseText].filter(Boolean).join(" ").trim();
  if (err.authenticationFailed || /AUTHENTICATIONFAILED|invalid credentials|authentication failed|login failed/i.test(detail)) {
    return (
      "identifiant ou mot de passe refusé pour la lecture des réponses. Vérifiez que l'accès IMAP est activé dans les paramètres " +
      "de votre messagerie, et utilisez un mot de passe d'application si la double authentification est active" +
      (detail ? ` (serveur : ${detail})` : "")
    );
  }
  if (err.code === "ENOTFOUND") return "serveur IMAP introuvable : vérifiez son nom";
  if (err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED") return "serveur IMAP injoignable : vérifiez le nom et le port (993 en général)";
  return detail ? `${errorMessage(e)} — ${detail}` : errorMessage(e);
}

/** Message SMTP compréhensible (port et mode TLS incohérents, identifiants refusés…). */
export function explainSmtpError(e: unknown, port: number, secure: boolean): string {
  const msg = errorMessage(e);
  const code = (e as { responseCode?: number })?.responseCode;
  if (code === 535 || /\b535\b|authentication|invalid login|username and password/i.test(msg)) {
    return `identifiant ou mot de passe refusé (utilisez un mot de passe d'application si la double authentification est active) — ${msg}`;
  }
  if (/closed unexpectedly|greeting never received|wrong version number|ssl3_get_record/i.test(msg)) {
    return `${msg} — vérifiez le port et le mode TLS : port 465 avec « TLS direct » activé, ou port 587 avec « TLS direct » désactivé${
      port === 465 && !secure ? " (ici : port 465 sans TLS direct)" : port === 587 && secure ? " (ici : port 587 avec TLS direct)" : ""
    }`;
  }
  return msg;
}
