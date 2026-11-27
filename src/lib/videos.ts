/**
 * Vidéo offerte : le visuel offert animé en un clip de quelques secondes, prêt pour les Reels et Stories.
 * Lancée dès que le visuel est prêt ; le job est suivi en tâche de fond (job « sample.video ») ;
 * le premier email n'est rédigé qu'une fois la vidéo prête (ou abandonnée), pour ne promettre que ce qui existe.
 */
import { and, eq } from "drizzle-orm";
import { saveUsage } from "@/lib/ai/usage";
import { downloadVideo, getVideoJob, submitImageToVideo, TERMINAL } from "@/lib/ai/video-api";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { companies, sampleVideos, samples, type Campaign, type Company, type Job, type Sample, type SampleVideo } from "@/lib/db/schema";
import { logEvent } from "@/lib/events";
import { enqueue, rescheduleJob } from "@/lib/jobs/queue";
import { errorMessage } from "@/lib/util";

/** Au-delà, une génération est abandonnée (l'email part avec le visuel seul). */
export const VIDEO_TIMEOUT_MS = 15 * 60_000;
/** Un échec (crédits, panne du fournisseur…) peut être relancé au-delà de ce délai. */
const RETRY_FAILED_MS = 10 * 60_000;
const POLL_MS = 30_000;

/** La campagne offre une vidéo (en plus du visuel), et on peut la produire. */
export function videoEnabled(c: Campaign): boolean {
  return !!c.settings.visualSample && !!c.settings.visualVideo && !config.demoMode && !!config.openrouter.apiKey;
}

export function sampleImageUrl(sampleId: string) {
  return `${config.appUrl.replace(/\/$/, "")}/v/${sampleId}/image`;
}

type VideoState = Pick<SampleVideo, "status" | "error" | "startedAt" | "updatedAt">;

/** État de la vidéo d'un visuel (sans les octets). */
export async function videoOf(sampleId: string): Promise<VideoState | null> {
  const db = await getDb();
  const [row] = await db
    .select({ status: sampleVideos.status, error: sampleVideos.error, startedAt: sampleVideos.startedAt, updatedAt: sampleVideos.updatedAt })
    .from(sampleVideos)
    .where(eq(sampleVideos.sampleId, sampleId));
  return row ?? null;
}

export type VideoGate = "start" | "wait" | "ready" | "skip";

/** Ce que doit faire la rédaction du premier email : lancer la vidéo, l'attendre, la citer, ou s'en passer. */
export function videoGate(v: VideoState | null, now = Date.now()): VideoGate {
  if (!v) return "start";
  if (v.status === "ready") return "ready";
  if (v.status === "pending") return now - v.startedAt.getTime() < VIDEO_TIMEOUT_MS + 2 * 60_000 ? "wait" : "skip";
  return "skip";
}

async function fail(sampleId: string, campaignId: string, companyName: string, error: string) {
  const db = await getDb();
  await db.update(sampleVideos).set({ status: "failed", error: error.slice(0, 500), updatedAt: new Date() }).where(eq(sampleVideos.sampleId, sampleId));
  await logEvent(campaignId, "warn", "video", `Vidéo non générée pour ${companyName} : l'email partira avec le visuel seul.`, {
    sampleId,
    tech: { error },
  });
}

/**
 * Lance la vidéo d'un visuel prêt (une seule fois par visuel ; un échec peut être relancé après 10 min).
 * Renvoie « started » si un job tourne désormais, « exists » si une vidéo est déjà prête ou en cours, « failed » sinon.
 */
export async function startSampleVideo(sample: Sample, c: Campaign, co: Pick<Company, "name">): Promise<"started" | "exists" | "failed"> {
  if (sample.status !== "ready") return "failed";
  const db = await getDb();
  const now = new Date();
  let [claimed] = await db
    .insert(sampleVideos)
    .values({ sampleId: sample.id, campaignId: c.id, status: "pending", startedAt: now })
    .onConflictDoNothing()
    .returning();
  if (!claimed) {
    const [row] = await db.select().from(sampleVideos).where(eq(sampleVideos.sampleId, sample.id));
    if (!row || row.status !== "failed") return "exists";
    if (Date.now() - row.updatedAt.getTime() < RETRY_FAILED_MS) return "failed";
    [claimed] = await db
      .update(sampleVideos)
      .set({ status: "pending", error: null, jobId: null, startedAt: now, updatedAt: now })
      .where(and(eq(sampleVideos.sampleId, sample.id), eq(sampleVideos.updatedAt, row.updatedAt)))
      .returning();
    if (!claimed) return "exists";
  }
  try {
    const job = await submitImageToVideo(sampleImageUrl(sample.id));
    await db.update(sampleVideos).set({ jobId: job.id, model: job.model, updatedAt: new Date() }).where(eq(sampleVideos.sampleId, sample.id));
    await enqueue("sample.video", { sampleId: sample.id }, { campaignId: c.id, runAt: new Date(Date.now() + 40_000), priority: 3, maxAttempts: 5 });
    await logEvent(c.id, "info", "video", `🎬 Vidéo offerte en préparation pour ${co.name}`, { sampleId: sample.id });
    return "started";
  } catch (e) {
    await fail(sample.id, c.id, co.name, errorMessage(e));
    return "failed";
  }
}

/** Suit le job de génération : clip prêt → enregistré ; en cours → on repasse plus tard ; trop long ou échec → abandon. */
export async function pollSampleVideo(job: Job) {
  const sampleId = job.payload.sampleId as string;
  const db = await getDb();
  const [row] = await db
    .select({
      status: sampleVideos.status,
      jobId: sampleVideos.jobId,
      model: sampleVideos.model,
      startedAt: sampleVideos.startedAt,
      campaignId: sampleVideos.campaignId,
      companyName: companies.name,
    })
    .from(sampleVideos)
    .innerJoin(samples, eq(samples.id, sampleVideos.sampleId))
    .innerJoin(companies, eq(companies.id, samples.companyId))
    .where(eq(sampleVideos.sampleId, sampleId));
  if (!row || row.status !== "pending") return;
  const tooLong = Date.now() - row.startedAt.getTime() > VIDEO_TIMEOUT_MS;
  if (!row.jobId) {
    if (tooLong) await fail(sampleId, row.campaignId, row.companyName, "Job de génération introuvable");
    return;
  }

  let status;
  try {
    status = await getVideoJob(row.jobId);
  } catch (e) {
    // Panne passagère : on réessaie, dans la limite du délai.
    if (tooLong) return fail(sampleId, row.campaignId, row.companyName, errorMessage(e));
    return rescheduleJob(job, new Date(Date.now() + 2 * POLL_MS));
  }

  if (status.status === "completed") {
    try {
      const video = await downloadVideo(status);
      const cost = status.usage?.cost ?? 0;
      await db
        .update(sampleVideos)
        .set({ status: "ready", mime: video.mime, data: video.data, costUsd: cost, error: null, updatedAt: new Date() })
        .where(eq(sampleVideos.sampleId, sampleId));
      await saveUsage({ campaignId: row.campaignId }, { operation: "visual.video", model: row.model ?? config.openrouter.videoModel, inputTokens: 0, outputTokens: 0, costUsd: cost });
      await logEvent(row.campaignId, "success", "video", `🎬 Vidéo offerte prête pour ${row.companyName}`, { sampleId });
    } catch (e) {
      await fail(sampleId, row.campaignId, row.companyName, errorMessage(e));
    }
    return;
  }
  if (TERMINAL.has(status.status)) return fail(sampleId, row.campaignId, row.companyName, status.error || `Génération ${status.status}`);
  if (tooLong) return fail(sampleId, row.campaignId, row.companyName, "La génération a pris trop de temps");
  return rescheduleJob(job, new Date(Date.now() + POLL_MS));
}
