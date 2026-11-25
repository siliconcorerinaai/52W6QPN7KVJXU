import { z } from "zod";
import { eq } from "drizzle-orm";
import { handle, json, type IdParams } from "@/lib/api";
import { getDb } from "@/lib/db";
import { mailboxes } from "@/lib/db/schema";
import { canAccess } from "@/lib/ownership";
import { requireUser } from "@/lib/session";
import type { SessionUser } from "@/lib/auth";

const Patch = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  fromName: z.string().trim().max(120).optional(),
  dailyLimit: z.number().int().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
});

/** Boîte ajoutée par ce compte (la boîte par défaut de la plateforme ne se modifie pas ici). */
async function ownedMailbox(id: string, user: SessionUser) {
  const db = await getDb();
  const [row] = await db.select({ id: mailboxes.id, userId: mailboxes.userId }).from(mailboxes).where(eq(mailboxes.id, id));
  return row && canAccess(row.userId, user) ? row : null;
}

export async function PATCH(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    if (id === "env") return json({ error: "La boîte par défaut est gérée par l'administrateur." }, 400);
    if (!(await ownedMailbox(id, user))) return json({ error: "Boîte introuvable" }, 404);
    const body = Patch.parse(await req.json());
    const db = await getDb();
    await db.update(mailboxes).set({ ...body, updatedAt: new Date() }).where(eq(mailboxes.id, id));
    return json({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    if (id === "env") return json({ error: "La boîte par défaut est gérée par l'administrateur." }, 400);
    if (!(await ownedMailbox(id, user))) return json({ error: "Boîte introuvable" }, 404);
    const db = await getDb();
    await db.delete(mailboxes).where(eq(mailboxes.id, id));
    return json({ ok: true });
  });
}
