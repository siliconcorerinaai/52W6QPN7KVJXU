/**
 * Lecture des réponses de prospects : on garde seulement ce que la personne a écrit,
 * sans l'historique cité (« Le … a écrit : », « On … wrote: », lignes « > », en-têtes Outlook).
 */
import { simpleParser } from "mailparser";

const QUOTE_HEADERS: RegExp[] = [
  // Gmail / Apple Mail, parfois coupé sur deux lignes : « On Thu, Nov 26, 2026 at 10:15 AM Franck <f@x.com>\nwrote: »
  /^On\s[\s\S]{0,300}?wrote:\s*$/im,
  /^Le\s[\s\S]{0,300}?a\s+écrit\s*:\s*$/im,
  /^El\s[\s\S]{0,300}?escribió:\s*$/im,
  /^Am\s[\s\S]{0,300}?schrieb[\s\S]{0,60}?:\s*$/im,
  // Outlook
  /^-{2,}\s*(Original Message|Message d'origine|Mensaje original)\s*-{2,}/im,
  /^_{10,}\s*$/m,
  /^(From|De)\s*:\s.+\r?\n(Sent|Envoyé|Date)\s*:/im,
];

/** Le texte écrit par le prospect, sans l'historique cité ni les lignes « > ». */
export function cleanReplyText(text: string, maxChars = 5000): string {
  let t = text.replace(/\r\n/g, "\n");
  let cut = t.length;
  for (const re of QUOTE_HEADERS) {
    const m = re.exec(t);
    if (m && m.index < cut) cut = m.index;
  }
  t = t.slice(0, cut);
  t = t
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > maxChars ? `${t.slice(0, maxChars - 1)}…` : t;
}

export type ParsedReply = {
  text: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromName: string | null;
  date: Date | null;
};

/** Décode un message brut (MIME) et en extrait la réponse lisible. */
export async function parseReply(source: string | Buffer): Promise<ParsedReply> {
  const mail = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const raw = mail.text?.trim() || htmlToText(typeof mail.html === "string" ? mail.html : "");
  const refs = mail.references ? (Array.isArray(mail.references) ? mail.references : [mail.references]) : [];
  return {
    text: cleanReplyText(raw),
    messageId: mail.messageId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    references: refs,
    fromName: mail.from?.value?.[0]?.name || null,
    date: mail.date ?? null,
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}
