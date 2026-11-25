import { sql } from "drizzle-orm";
import { config } from "@/lib/config";
import { dbDriver, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Sonde de santé (healthcheck Railway) : base joignable et migrations appliquées. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: dbDriver(), ai: config.demoMode ? "demo" : config.ai.provider });
  } catch (e) {
    console.error("[health]", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
