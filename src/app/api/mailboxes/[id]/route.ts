import { z } from "zod";
import { eq } from "drizzle-orm";
import { handle, json, type IdParams } from "@/lib/api";
import { getDb } from "@/lib/db";
import { mailboxes } from "@/lib/db/schema";

const Patch = z.object({
  label: z.string().trim().min(1).optional(),
  fromName: z.string().trim().optional(),
  dailyLimit: z.number().int().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    if (id === "env") return json({ error: "La boîte par défaut se règle par variables d'environnement" }, 400);
    const body = Patch.parse(await req.json());
    const db = await getDb();
    await db.update(mailboxes).set({ ...body, updatedAt: new Date() }).where(eq(mailboxes.id, id));
    return json({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    if (id === "env") return json({ error: "La boîte par défaut se retire en supprimant ses variables d'environnement" }, 400);
    const db = await getDb();
    await db.delete(mailboxes).where(eq(mailboxes.id, id));
    return json({ ok: true });
  });
}
