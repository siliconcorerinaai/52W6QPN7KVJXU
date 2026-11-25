import { z } from "zod";
import { handle, json } from "@/lib/api";
import { sendEmail, verifySmtp } from "@/lib/outreach/mailer";

const Body = z.object({ to: z.string().email() });

export async function POST(req: Request) {
  return handle(async () => {
    const { to } = Body.parse(await req.json());
    await verifySmtp();
    const res = await sendEmail({
      to,
      subject: "Test Prospecta ✔",
      body: "Bonjour,\n\nCeci est un email de test envoyé depuis Prospecta. Votre configuration SMTP fonctionne.\n\nÀ bientôt !",
    });
    return json({ ok: true, messageId: res.messageId });
  });
}
