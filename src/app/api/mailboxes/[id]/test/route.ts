import { handle, json, type IdParams } from "@/lib/api";
import { getMailbox } from "@/lib/outreach/mailboxes";
import { verifySmtp } from "@/lib/outreach/mailer";
import { errorMessage } from "@/lib/util";
import { testImap } from "@/lib/outreach/mailbox-admin";

export const maxDuration = 60;

/** Teste la connexion SMTP et IMAP d'une boîte existante. */
export async function POST(_req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const mb = await getMailbox(id);
    if (!mb) return json({ error: "Boîte introuvable" }, 404);
    let smtp: string | null = null;
    try {
      await verifySmtp(mb);
    } catch (e) {
      smtp = errorMessage(e);
    }
    const imap = mb.imap ? await testImap(mb) : "non configuré";
    return json({ smtp: smtp ?? "ok", imap: imap ?? "ok" });
  });
}
