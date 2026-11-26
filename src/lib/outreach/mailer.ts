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
  /** Langue du message (code ISO) : celle du pied de page (désinscription). */
  language?: string | null;
};

const FOOTER = {
  fr: { stop: "Pour ne plus recevoir de messages :", link: "Se désinscrire" },
  en: { stop: "To stop receiving these emails:", link: "Unsubscribe" },
  es: { stop: "Para no recibir más mensajes:", link: "Darse de baja" },
  de: { stop: "Keine weiteren Nachrichten erhalten:", link: "Abmelden" },
  it: { stop: "Per non ricevere più messaggi:", link: "Annulla iscrizione" },
  nl: { stop: "Geen berichten meer ontvangen:", link: "Afmelden" },
  pt: { stop: "Para não receber mais mensagens:", link: "Cancelar inscrição" },
};
export const footerText = (language?: string | null) =>
  FOOTER[(language ?? "").slice(0, 2).toLowerCase() as keyof typeof FOOTER] ?? FOOTER.en;

/** Envoie un email texte + HTML minimal, avec pied de page légal et désinscription en un clic. */
export async function sendEmail(mail: OutgoingEmail, mailbox: SendingMailbox): Promise<{ messageId: string }> {
  const senderAddress = await getSenderAddress(mailbox.userId);
  const t = footerText(mail.language ?? "fr");
  const footerLines = [senderAddress, mail.contactId ? `${t.stop} ${unsubscribeUrl(mail.contactId)}` : ""].filter(Boolean);
  const text = `${mail.body.trim()}\n\n--\n${footerLines.join("\n")}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${mail.body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("")}<p style="margin-top:24px;font-size:11px;color:#888">${[
    senderAddress && escapeHtml(senderAddress),
    mail.contactId ? `<a href="${unsubscribeUrl(mail.contactId)}" style="color:#888">${t.link}</a>` : "",
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

const strip = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Fuseau horaire des destinataires d'après le pays (heures de bureau locales). Null si inconnu. */
export function timeZoneFor(country: string | null | undefined): string | null {
  const c = strip(country ?? "");
  if (!c) return null;
  const zones: [RegExp, string][] = [
    [/etats-unis|united states|\busa?\b|amerique/, "America/Chicago"],
    [/canada|quebec/, "America/Toronto"],
    [/royaume-uni|united kingdom|\buk\b|angleterre|england|irlande|ireland|portugal/, "Europe/London"],
    [/france|belgique|belgium|suisse|switzerland|luxembourg|allemagne|germany|espagne|spain|italie|italy|pays-bas|netherlands|monaco|autriche/, "Europe/Paris"],
    [/cote d.ivoire|ivory coast|senegal|mali|burkina|guinee|guinea|ghana|togo|mauritanie/, "Africa/Abidjan"],
    [/cameroun|cameroon|gabon|congo|benin|niger|nigeria|tchad|centrafrique/, "Africa/Lagos"],
    [/maroc|morocco/, "Africa/Casablanca"],
    [/tunisie|tunisia|algerie|algeria/, "Africa/Tunis"],
    [/emirats|emirates|dubai/, "Asia/Dubai"],
    [/arabie|saudi/, "Asia/Riyadh"],
    [/kenya|rwanda|ouganda|uganda|tanzanie/, "Africa/Nairobi"],
    [/afrique du sud|south africa/, "Africa/Johannesburg"],
    [/madagascar|maurice|mauritius|reunion/, "Indian/Mauritius"],
  ];
  return zones.find(([re]) => re.test(c))?.[1] ?? null;
}

/** Jour de la semaine (0 = dimanche) et heure dans un fuseau donné. */
function localClock(d: Date, timeZone: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(d);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "Mon");
  return { day, hour: Number(parts.find((p) => p.type === "hour")?.value ?? 12) };
}

/**
 * Prochain créneau d'envoi : jours ouvrés, 8h–18h dans le fuseau des destinataires
 * (heure du serveur si inconnu), avec un léger aléa.
 */
export function nextSendSlot(from = new Date(), timeZone?: string | null): Date {
  if (!timeZone) {
    const d = new Date(from);
    const isWeekday = (x: Date) => x.getDay() >= 1 && x.getDay() <= 5;
    if (isWeekday(d) && d.getHours() >= 8 && d.getHours() < 18) return d;
    if (d.getHours() >= 18 || !isWeekday(d)) d.setDate(d.getDate() + 1);
    d.setHours(8, Math.floor(Math.random() * 50), 0, 0);
    while (!isWeekday(d)) d.setDate(d.getDate() + 1);
    return d;
  }
  const open = (x: Date) => {
    const { day, hour } = localClock(x, timeZone);
    return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
  };
  if (open(from)) return new Date(from);
  // Avance heure par heure jusqu'à l'ouverture (au plus ~3 jours), puis ajoute un léger aléa.
  const d = new Date(from);
  d.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 4 && !open(d); i++) d.setTime(d.getTime() + 3_600_000);
  return new Date(d.getTime() + Math.floor(Math.random() * 50) * 60_000);
}
