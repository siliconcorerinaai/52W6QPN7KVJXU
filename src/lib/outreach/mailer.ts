import { createHmac, timingSafeEqual } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "@/lib/config";
import type { SendingMailbox } from "./mailboxes";
import { getSenderAddress } from "./sender";

export function unsubscribeToken(contactId: string): string {
  return createHmac("sha256", config.unsubscribeSecret).update(contactId).digest("base64url").slice(0, 24);
}

export function verifyUnsubscribeToken(contactId: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(contactId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(contactId: string) {
  return `${config.appUrl}/api/unsubscribe?c=${encodeURIComponent(contactId)}&t=${unsubscribeToken(contactId)}`;
}

const transports = new Map<string, Transporter>();

/** Transport SMTP d'une boîte (mis en cache ; recréé si ses paramètres changent). */
function getTransport(mailbox: SendingMailbox): Transporter {
  const { host, port, secure, user, pass } = mailbox.smtp;
  const key = `${mailbox.id}|${host}|${port}|${secure}|${user}|${pass.length}`;
  let t = transports.get(key);
  if (!t) {
    t = nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined });
    transports.set(key, t);
  }
  return t;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Rend les URL cliquables dans la version HTML (lien de rendez-vous…). */
function linkify(html: string) {
  return html.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)»]/g, (url) => `<a href="${url}">${url}</a>`);
}

export type OutgoingEmail = {
  to: string;
  toName?: string;
  subject: string;
  body: string;
  contactId?: string;
  inReplyTo?: string | null;
};

/** Envoie un email texte + HTML minimal, avec pied de page légal et désinscription en un clic. */
export async function sendEmail(mail: OutgoingEmail, mailbox: SendingMailbox): Promise<{ messageId: string }> {
  const senderAddress = await getSenderAddress(mailbox.userId);
  const footerLines = [
    senderAddress,
    mail.contactId ? `Pour ne plus recevoir de messages : ${unsubscribeUrl(mail.contactId)}` : "",
  ].filter(Boolean);
  const text = `${mail.body.trim()}\n\n--\n${footerLines.join("\n")}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${mail.body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("")}<p style="margin-top:24px;font-size:11px;color:#888">${[
    senderAddress && escapeHtml(senderAddress),
    mail.contactId ? `<a href="${unsubscribeUrl(mail.contactId)}" style="color:#888">Se désinscrire</a>` : "",
  ]
    .filter(Boolean)
    .join(" · ")}</p></div>`;

  const headers: Record<string, string> = {};
  if (mail.contactId) {
    headers["List-Unsubscribe"] = `<${unsubscribeUrl(mail.contactId)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const info = await getTransport(mailbox).sendMail({
    from: mailbox.fromName ? { name: mailbox.fromName, address: mailbox.fromEmail } : mailbox.fromEmail,
    to: mail.toName ? { name: mail.toName, address: mail.to } : mail.to,
    subject: mail.subject,
    text,
    html,
    headers,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.inReplyTo ?? undefined,
  });
  return { messageId: info.messageId };
}

export async function verifySmtp(mailbox: SendingMailbox): Promise<void> {
  await getTransport(mailbox).verify();
}

/** Prochain créneau d'envoi : jours ouvrés, 8h–18h (heure du serveur), avec un léger aléa. */
export function nextSendSlot(from = new Date()): Date {
  const d = new Date(from);
  const isWeekday = (x: Date) => x.getDay() >= 1 && x.getDay() <= 5;
  if (isWeekday(d) && d.getHours() >= 8 && d.getHours() < 18) return d;
  if (d.getHours() >= 18 || !isWeekday(d)) d.setDate(d.getDate() + 1);
  d.setHours(8, Math.floor(Math.random() * 50), 0, 0);
  while (!isWeekday(d)) d.setDate(d.getDate() + 1);
  return d;
}
