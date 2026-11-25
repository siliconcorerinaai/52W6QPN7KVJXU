import { inArray, sql } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { appState, contacts } from "@/lib/db/schema";
import { listMailboxes } from "@/lib/outreach/mailboxes";
import { enqueue } from "./queue";

const SYNC_EVERY_MINUTES = 5;
let lastCheck = 0;

/**
 * Réserve un créneau de façon atomique (toutes instances confondues) :
 * renvoie true au plus une fois par intervalle pour une clé donnée.
 */
export async function claimInterval(key: string, minutes: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .insert(appState)
    .values({ key, value: {} })
    .onConflictDoUpdate({
      target: appState.key,
      set: { updatedAt: sql`now()` },
      setWhere: sql`${appState.updatedAt} < now() - make_interval(mins => ${minutes})`,
    })
    .returning({ key: appState.key });
  return rows.length > 0;
}

/** Programme la lecture des boîtes de réception toutes les 5 minutes, quand des réponses sont attendues. */
export async function maybeScheduleInboxSync({ force = false } = {}) {
  if (config.demoMode) return false;
  if (!force && Date.now() - lastCheck < 60_000) return false;
  lastCheck = Date.now();
  try {
    const boxes = (await listMailboxes()).filter((b) => b.imap);
    if (!boxes.length) return false;
    if (!force) {
      const db = await getDb();
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(contacts)
        .where(inArray(contacts.status, ["sent", "approved"]));
      if (!row?.n) return false;
      if (!(await claimInterval("inbox_sync", SYNC_EVERY_MINUTES))) return false;
    }
    await enqueue("mailbox.sync", {}, { priority: 3, maxAttempts: 1 });
    return true;
  } catch (e) {
    console.error("[schedule] lecture des boîtes non programmée", e);
    return false;
  }
}
