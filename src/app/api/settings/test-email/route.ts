import { z } from "zod";
import { handle, json } from "@/lib/api";
import { sendEmail, verifySmtp } from "@/lib/outreach/mailer";
import { ENV_MAILBOX_ID, getMailbox } from "@/lib/outreach/mailboxes";

const Body = z.object({ to: z.string().email(), mailboxId: z.string().default(ENV_MAILBOX_ID) });

export async function POST(req: Request) {
  return handle(async () => {
    const { to, mailboxId } = Body.parse(await req.json());
    const mailbox = await getMailbox(mailboxId);
    if (!mailbox) return json({ error: "Boîte d'envoi introuvable" }, 404);
    await verifySmtp(mailbox);
    const res = await sendEmail(
      {
        to,
        subject: "Test Prospecta ✔",
        body: `Bonjour,\n\nCeci est un email de test envoyé depuis Prospecta avec la boîte ${mailbox.fromEmail}. La configuration SMTP fonctionne.\n\nÀ bientôt !`,
      },
      mailbox,
    );
    return json({ ok: true, messageId: res.messageId });
  });
}
