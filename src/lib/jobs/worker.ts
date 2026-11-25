import { hostname } from "node:os";
import { claimJob, completeJob, failJob, recoverStaleJobs } from "./queue";
import { runJob } from "@/lib/pipeline/handlers";
import { logEvent } from "@/lib/events";
import { errorMessage, sleep } from "@/lib/util";
import { config } from "@/lib/config";
import type { Job } from "@/lib/db/schema";

const workerId = `${hostname()}-${process.pid}`;

async function processOne(job: Job) {
  try {
    await runJob(job);
    await completeJob(job.id);
  } catch (e) {
    const msg = errorMessage(e);
    const final = await failJob(job, msg);
    console.error(`[worker] job ${job.id} (${job.type}) a échoué${final ? " définitivement" : ""} : ${msg}`);
    if (final) await logEvent(job.campaignId, "error", job.type, `Échec définitif : ${msg}`, { jobId: job.id });
  }
}

/** Traite des jobs jusqu'à épuisement de la file ou de l'échéance (mode serverless / cron). */
export async function tick({ maxJobs = 50, deadlineMs = 50_000, concurrency = config.worker.concurrency } = {}) {
  const deadline = Date.now() + deadlineMs;
  let processed = 0;
  await recoverStaleJobs();
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
