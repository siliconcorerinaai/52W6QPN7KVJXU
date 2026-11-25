import { getDb } from "@/lib/db";
import { events } from "@/lib/db/schema";

export type LogLevel = "info" | "success" | "warn" | "error";

/** Journalise une action de l'agent : affichée en direct dans le fil d'activité de la campagne. */
export async function logEvent(
  campaignId: string | null,
  level: LogLevel,
  kind: string,
  message: string,
  data?: Record<string, unknown>,
) {
  try {
    const db = await getDb();
    await db.insert(events).values({ campaignId, level, kind, message, data: data ?? null });
  } catch (e) {
    console.error("[events] échec d'écriture", e);
  }
}
