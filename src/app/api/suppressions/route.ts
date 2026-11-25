import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { handle, json } from "@/lib/api";
import { getDb } from "@/lib/db";
import { suppressions } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";

const Body = z.object({
  values: z.array(z.string().min(3).max(320)).min(1).max(5000),
  reason: z.string().max(40).default("manual"),
});

/** Ajoute des emails ou des domaines (@acme.fr) à la liste d'exclusion du compte. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { values, reason } = Body.parse(await req.json());
    const db = await getDb();
    const clean = values
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .map((v) => (v.includes("@") ? v : `@${v.replace(/^@/, "")}`));
    for (const value of clean) await db.insert(suppressions).values({ userId: user.id, value, reason }).onConflictDoNothing();
    return json({ added: clean.length });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const value = new URL(req.url).searchParams.get("value");
    if (!value) return json({ error: "value requis" }, 400);
    const db = await getDb();
    await db.delete(suppressions).where(and(eq(suppressions.userId, user.id), eq(suppressions.value, value)));
    return json({ ok: true });
  });
}
