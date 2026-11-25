import { hostname } from "node:os";
import { claimJob, completeJob, failJob, recoverStaleJobs } from "./queue";
import { runJob } from "@/lib/pipeline/handlers";
import { logEvent } from "@/lib/events";
import { errorMessage, sleep } from "@/lib/util";
import { config, isServerless } from "@/lib/config";
import type { Job } from "@/lib/db/schema";

const workerId = `${hostname()}-${process.pid}`;

/**
 * Durée maximale d'une tâche. En serverless, la fonction est coupée à 300 s : au-delà de 240 s
 * on abandonne proprement (la tâche est retentée) plutôt que de la laisser « en cours » à jamais.
 */
const JOB_TIMEOUT_MS = () => (isServerless() ? 240_000 : 15 * 60_000);
/** Une tâche « en cours » depuis plus longtemps est considérée comme orpheline et remise en file. */
export const STALE_MINUTES = () => (isServerless() ? 6 : 20);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Délai dépassé (${Math.round(ms / 1000)} s) pour ${label}`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function processOne(job: Job) {
  const started = Date.now();
  console.log(`[worker] ▶ job ${job.id} ${job.type} (tentative ${job.attempts})`);
  try {
    await withTimeout(runJob(job), JOB_TIMEOUT_MS(), job.type);
    await completeJob(job.id);
    console.log(`[worker] ✓ job ${job.id} ${job.type} en ${Date.now() - started} ms`);
  } catch (e) {
    const msg = errorMessage(e);
    const final = await failJob(job, msg);
    console.error(`[worker] ✗ job ${job.id} (${job.type}) a échoué${final ? " définitivement" : ""} : ${msg}`);
    if (final) await logEvent(job.campaignId, "error", job.type, `Échec définitif : ${msg}`, { jobId: job.id });
  }
}

/** Traite des jobs jusqu'à épuisement de la file ou de l'échéance (mode serverless / cron). */
export async function tick({ maxJobs = 50, deadlineMs = 50_000, concurrency = config.worker.concurrency } = {}) {
  const deadline = Date.now() + deadlineMs;
  let processed = 0;
  await recoverStaleJobs(STALE_MINUTES());
  const lanes = Array.from({ length: concurrency }, async () => {
    while (processed < maxJobs && Date.now() < deadline) {
      const job = await claimJob(workerId);
      if (!job) return;
      processed++;
      await processOne(job);
    }
  });
  await Promise.all(lanes);
  return processed;
}

type WorkerState = { running: boolean; stop: () => void };
const g = globalThis as unknown as { __prospectaWorker?: WorkerState };

/** Démarre la boucle de traitement continue (serveur long-vivant ou `npm run worker`). */
export function startWorker({ concurrency = config.worker.concurrency, idleMs = 1500 } = {}) {
  if (g.__prospectaWorker?.running) return g.__prospectaWorker;
  const state: WorkerState = { running: true, stop: () => (state.running = false) };
  g.__prospectaWorker = state;

  (async () => {
    try {
      await recoverStaleJobs(0);
    } catch (e) {
      console.error("[worker] récupération impossible", e);
    }
    console.log(`[worker] démarré (${concurrency} voies, id=${workerId})`);
    const lane = async () => {
      while (state.running) {
        let job: Job | null = null;
        try {
          job = await claimJob(workerId);
        } catch (e) {
          console.error("[worker] claim", errorMessage(e));
        }
        if (!job) {
          await sleep(idleMs + Math.random() * 500);
          continue;
        }
        await processOne(job);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, lane));
  })();

  return state;
}
