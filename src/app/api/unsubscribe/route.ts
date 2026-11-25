import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { campaigns, contacts, suppressions } from "@/lib/db/schema";
import { verifyUnsubscribeToken } from "@/lib/outreach/mailer";
import { setContactStatus } from "@/lib/pipeline/campaigns";

export const dynamic = "force-dynamic";

function page(title: string, text: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#111;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border-radius:16px;padding:32px;max-width:420px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 8px}p{color:#555;line-height:1.5;margin:0}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function unsubscribe(req: Request) {
  const url = new URL(req.url);
  const contactId = url.searchParams.get("c") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!contactId || !token || !verifyUnsubscribeToken(contactId, token)) {
    return page("Lien invalide", "Ce lien de désinscription n'est pas valide.", 400);
  }
  const db = await getDb();
  const [ct] = await db
    .select({ email: contacts.email, ownerId: campaigns.userId })
    .from(contacts)
    .innerJoin(campaigns, eq(campaigns.id, contacts.campaignId))
    .where(eq(contacts.id, contactId));
  if (ct?.email) {
    // Exclusion pour le compte qui a envoyé l'email (vide = plateforme).
    await db.insert(suppressions).values({ userId: ct.ownerId ?? "", value: ct.email.toLowerCase(), reason: "unsubscribe" }).onConflictDoNothing();
    await setContactStatus(contactId, "unsubscribed");
  }
  return page("Désinscription confirmée", "Vous ne recevrez plus de messages de cet expéditeur. Merci et bonne journée.");
}

export const GET = unsubscribe;
export const POST = unsubscribe; // RFC 8058 : désinscription en un clic
