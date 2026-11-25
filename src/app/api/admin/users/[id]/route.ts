import { z } from "zod";
import { eq } from "drizzle-orm";
import { handle, json, type IdParams } from "@/lib/api";
import { deleteUserSessions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/session";

const Patch = z.object({
  monthlyCompanyLimit: z.number().int().min(0).max(1_000_000).optional(),
  disabled: z.boolean().optional(),
  role: z.enum(["user", "admin"]).optional(),
});

/** Modifie un compte : limite mensuelle, désactivation, rôle (administrateur uniquement). */
export async function PATCH(req: Request, { params }: IdParams) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = Patch.parse(await req.json());
    if (id === admin.id && (body.disabled || body.role === "user")) {
      return json({ error: "Vous ne pouvez pas désactiver votre propre compte ni retirer vos droits." }, 400);
    }
    const db = await getDb();
    const [row] = await db.update(users).set({ ...body, updatedAt: new Date() }).where(eq(users.id, id)).returning({ id: users.id });
    if (!row) return json({ error: "Compte introuvable" }, 404);
    if (body.disabled) await deleteUserSessions(id);
    return json({ ok: true });
  });
}
