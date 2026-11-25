import { eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { appState } from "@/lib/db/schema";

/** Clé de l'adresse d'un compte ; sans compte : celle de la plateforme (boîte par défaut). */
const keyFor = (userId: string | null | undefined) => (userId ? `settings:sender:${userId}` : "settings:sender");

/**
 * Adresse postale en pied d'email, propre à chaque compte (réglée dans Paramètres).
 * La plateforme garde en repli SENDER_ADDRESS ; un client doit renseigner la sienne.
 */
export async function getSenderAddress(userId?: string | null): Promise<string> {
  try {
    const db = await getDb();
    const [row] = await db.select().from(appState).where(eq(appState.key, keyFor(userId)));
    const address = (row?.value as { address?: unknown } | undefined)?.address;
    if (typeof address === "string" && address.trim()) return address.trim();
  } catch (e) {
    console.error("[sender] lecture impossible", e);
  }
  return userId ? "" : config.smtp.senderAddress;
}

export async function setSenderAddress(userId: string | null, address: string) {
  const db = await getDb();
  const value = { address: address.trim() };
  await db
    .insert(appState)
    .values({ key: keyFor(userId), value })
    .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: new Date() } });
}
