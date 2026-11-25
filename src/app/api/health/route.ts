import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Sonde de santé publique : ne dit rien de l'infrastructure, seulement si l'application répond. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[health]", e);
    return Response.json({ ok: false }, { status: 503 });
  }
}
