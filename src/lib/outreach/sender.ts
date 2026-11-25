import { eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { appState } from "@/lib/db/schema";

const KEY = "settings:sender";

/** Adresse postale en pied d'email : réglée dans Paramètres, sinon SENDER_ADDRESS. */
export async function getSenderAddress(): Promise<string> {
  try {
    const db = await getDb();
    const [row] = await db.select().from(appState).where(eq(appState.key, KEY));
    const address = (row?.value as { address?: unknown } | undefined)?.address;
    if (typeof address === "string" && address.trim()) return address.trim();
  } catch (e) {
    console.error("[sender] lecture impossible", e);
  }
  return config.smtp.senderAddress;
}

export async function setSenderAddress(address: string) {
  const db = await getDb();
  const value = { address: address.trim() };
  await db
    .insert(appState)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: new Date() } });
}
