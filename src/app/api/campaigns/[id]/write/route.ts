import { z } from "zod";
import { inArray, and, eq } from "drizzle-orm";
import { kickWorker } from "@/lib/jobs/kick";
import { handle, json, type IdParams } from "@/lib/api";
import { requestWrite } from "@/lib/pipeline/campaigns";
import { getDb } from "@/lib/db";
import { contacts } from "@/lib/db/schema";

export const maxDuration = 300;

const Body = z.object({ contactIds: z.array(z.string()).optional() });

/** Rédige les séquences des contacts donnés (ou de tous les leads prêts). */
export async function POST(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const body = Body.parse(await req.json().catch(() => ({})));
    let ids = body.contactIds;
    if (!ids?.length) {
      const db = await getDb();
      const rows = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.campaignId, id), inArray(contacts.status, ["ready"])));
      ids = rows.map((r) => r.id);
    }
    const queued = await requestWrite(ids);
    kickWorker();
    return json({ queued });
  });
}
