/**
 * Échantillons visuels offerts aux prospects : un visuel promo à l'image de chaque entreprise
 * qualifiée, hébergé sur une page publique (/v/<id>) et cité dans le premier email.
 * « Donner avant de demander » : c'est ce qui fait répondre les commerces.
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { intelligence } from "@/lib/ai";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { sampleVideos, samples, type Campaign, type Company, type Sample } from "@/lib/db/schema";
import { logEvent } from "@/lib/events";
import { errorMessage, sleep } from "@/lib/util";
import { DEFAULT_VISUAL_BRIEF } from "@/lib/visual-prompt";
import { startSampleVideo, videoEnabled } from "@/lib/videos";

export { DEFAULT_VISUAL_BRIEF, visualPrompt } from "@/lib/visual-prompt";

/** Délai au-delà duquel une génération « en cours » est considérée comme abandonnée. */
const STALE_MS = 4 * 60_000;
/** Un échec (crédits épuisés, panne du fournisseur…) est retenté au-delà de ce délai. */
const RETRY_FAILED_MS = 10 * 60_000;


export function sampleUrl(id: string): string {
  return `${config.appUrl.replace(/\/$/, "")}/v/${id}`;
}

/** Réduit l'image (1080 px de côté au plus, JPEG) pour l'héberger et l'afficher vite. */
export async function compressImage(data: Buffer, mime: string): Promise<{ data: Buffer; mime: string }> {
  if (!/^image\/(png|jpe?g|webp)$/.test(mime)) return { data, mime };
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(data).rotate().resize({ width: 1080, height: 1080, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    return { data: out, mime: "image/jpeg" };
  } catch (e) {
    console.error("[visuals] compression impossible", e);
    return { data, mime };
  }
}

async function generateInto(row: Sample, c: Campaign, co: Company): Promise<Sample | null> {
  const db = await getDb();
  try {
    const brief = c.settings.visualBrief?.trim() || DEFAULT_VISUAL_BRIEF;
    const v = await intelligence().generateVisual({ company: co, offer: c.offer, brief }, { campaignId: c.id });
    const img = await compressImage(v.data, v.mime);
    const [ready] = await db
      .update(samples)
      .set({ status: "ready", mime: img.mime, data: img.data, prompt: v.prompt, error: null, updatedAt: new Date() })
      .where(eq(samples.id, row.id))
      .returning();
    await logEvent(c.id, "success", "visual", `🎨 Visuel offert préparé pour ${co.name}`, { companyId: co.id, sampleId: row.id });
    // Vidéo offerte : lancée tout de suite, elle sera prête quand le premier email sera rédigé.
    if (ready && videoEnabled(c)) await startSampleVideo(ready, c, co);
    return ready ?? null;
  } catch (e) {
    await db.update(samples).set({ status: "failed", error: errorMessage(e).slice(0, 500), updatedAt: new Date() }).where(eq(samples.id, row.id));
    await logEvent(c.id, "warn", "visual", `Visuel non généré pour ${co.name} : l'email partira sans visuel.`, {
      companyId: co.id,
      tech: { error: errorMessage(e) },
    });
    return null;
  }
}

/**
 * Renvoie le visuel prêt d'une entreprise, en le générant si besoin (une seule fois par entreprise,
 * même si plusieurs étapes le demandent en parallèle). Null si la génération a échoué.
 */
export async function ensureSample(c: Campaign, co: Company, waitMs = 90_000): Promise<Sample | null> {
  const db = await getDb();
  const [claimed] = await db
    .insert(samples)
    .values({ id: randomBytes(16).toString("base64url"), campaignId: c.id, companyId: co.id, status: "pending", language: co.language })
    .onConflictDoNothing()
    .returning();
  if (claimed) return generateInto(claimed, c, co);

  // Déjà demandé : on attend la génération en cours (ou on la reprend si elle a été abandonnée).
  const deadline = Date.now() + waitMs;
  while (true) {
    const [row] = await db.select().from(samples).where(eq(samples.companyId, co.id));
    if (!row) return null;
    if (row.status === "ready") return row;
    const age = Date.now() - row.updatedAt.getTime();
    if (row.status === "failed" && age < RETRY_FAILED_MS) return null;
    if (row.status === "failed" || age > STALE_MS) {
      const [taken] = await db
        .update(samples)
        .set({ status: "pending", updatedAt: new Date() })
        .where(and(eq(samples.id, row.id), eq(samples.updatedAt, row.updatedAt)))
        .returning();
      if (taken) return generateInto(taken, c, co);
    }
    if (Date.now() > deadline) return null;
    await sleep(3000);
  }
}

/** Visuel d'une entreprise et état de sa vidéo (sans les octets), pour l'affichage. */
export async function sampleOf(companyId: string): Promise<{ id: string; status: string; video: string | null } | null> {
  const db = await getDb();
  const [row] = await db
    .select({ id: samples.id, status: samples.status, video: sampleVideos.status })
    .from(samples)
    .leftJoin(sampleVideos, eq(sampleVideos.sampleId, samples.id))
    .where(eq(samples.companyId, companyId));
  return row ?? null;
}

/** Ajoute le lien du visuel au premier email s'il n'y figure pas (après le premier paragraphe). */
export function withSampleLink(body: string, url: string): string {
  if (body.includes(url)) return body;
  const parts = body.split(/\n{2,}/);
  parts.splice(Math.min(1, parts.length), 0, url);
  return parts.join("\n\n");
}
