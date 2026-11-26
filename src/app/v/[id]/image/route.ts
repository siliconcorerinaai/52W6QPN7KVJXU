import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { samples } from "@/lib/db/schema";

/** Image d'un visuel offert (publique : son adresse aléatoire figure dans l'email du prospect). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w-]{10,40}$/.test(id)) return new Response("Introuvable", { status: 404 });
  const db = await getDb();
  const [row] = await db.select({ status: samples.status, mime: samples.mime, data: samples.data }).from(samples).where(eq(samples.id, id));
  if (!row || row.status !== "ready" || !row.data || !row.mime) return new Response("Introuvable", { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      // Une image SVG ne doit jamais pouvoir exécuter de script.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
