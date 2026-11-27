import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sampleVideos } from "@/lib/db/schema";

/**
 * Vidéo offerte (publique, comme le visuel : son adresse aléatoire figure dans l'email du prospect).
 * Gère les requêtes partielles (Range) : Safari et iOS ne lisent pas une vidéo sans elles.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w-]{10,40}$/.test(id)) return new Response("Introuvable", { status: 404 });
  const db = await getDb();
  const [row] = await db
    .select({ status: sampleVideos.status, mime: sampleVideos.mime, data: sampleVideos.data })
    .from(sampleVideos)
    .where(eq(sampleVideos.sampleId, id));
  if (!row || row.status !== "ready" || !row.data || !row.mime?.startsWith("video/")) return new Response("Introuvable", { status: 404 });

  const size = row.data.length;
  const base = {
    "Content-Type": row.mime,
    "Accept-Ranges": "bytes",
    // Cache du navigateur seulement : le cache CDN de Vercel répond « 200 » à une requête partielle,
    // ce qui empêche Safari / iOS de lire la vidéo.
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range")?.trim() ?? "");
  if (!range || (!range[1] && !range[2])) {
    return new Response(new Uint8Array(row.data), { headers: { ...base, "Content-Length": String(size) } });
  }
  // « bytes=a-b », « bytes=a- » ou « bytes=-n » (les n derniers octets)
  let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  end = Math.min(end, size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  start = Math.max(0, start);
  return new Response(new Uint8Array(row.data.subarray(start, end + 1)), {
    status: 206,
    headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
