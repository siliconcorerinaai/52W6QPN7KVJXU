import { hostname } from "node:os";
import { claimJob, completeJob, failJob, recoverStaleJobs } from "./queue";
import { runJob } from "@/lib/pipeline/handlers";
import { maybeScheduleInboxSync } from "./schedule";
import { logEvent } from "@/lib/events";
import { errorMessage, sleep, TimeoutError, withTimeout } from "@/lib/util";
import { config, isServerless } from "@/lib/config";
import { resetDb } from "@/lib/db";
import type { Job } from "@/lib/db/schema";

const workerId = `${hostname()}-${process.pid}`;

/**
 * Durée maximale d'une tâche. En serverless, la fonction est coupée à 300 s : la file prend de
 * nouvelles tâches pendant 60 s au plus, et une tâche est abandonnée (puis retentée) au-delà de 200 s.
 */
const JOB_TIMEOUT_MS = () => (isServerless() ? 200_000 : 15 * 60_000);
/** Une tâche « en cours » depuis plus longtemps est considérée comme orpheline et remise en file. */
export const STALE_MINUTES = () => (isServerless() ? 6 : 20);
/** Durée maximale d'une opération de file (réserver, clôturer…) : ce sont de petites requêtes. */
const DB_STEP_MS = 20_000;

/**
 * Borne une opération de base. Si elle ne répond pas, le pool de connexions est recréé :
 * sans cela, une connexion morte bloquerait toutes les requêtes suivantes de l'instance.
 */
async function dbStep<T>(p: Promise<T>, label: string): Promise<T> {
  try {
    return await withTimeout(p, DB_STEP_MS, label);
  } catch (e) {
    if (e instanceof TimeoutError) await resetDb(`${label} sans réponse`);
    throw e;
  }
}

/** Nom d'une étape tel qu'affiché aux utilisateurs (sans détail technique). */
const STEP_LABEL: Record<string, string> = {
  "campaign.discover": "la recherche d'entreprises",
  "company.research": "l'analyse d'une entreprise",
  "company.contacts": "la recherche de décideurs",
  "company.visual": "la création d'un visuel offert",
  "contact.email": "la recherche d'un email",
  "contact.write": "la rédaction d'une séquence",
  "message.send": "l'envoi d'un email",
  "campaign.supervise": "le suivi de la campagne",
  "mailbox.sync": "la lecture des boîtes de réception",
};

/** Exécute un job et enregistre son issue. Ne lève jamais d'exception. */
async function processOne(job: Job) {
  const started = Date.now();
  console.log(`[worker] ▶ job ${job.id} ${job.type} (tentative ${job.attempts})`);
  let error: unknown = null;
  try {
    await withTimeout(runJob(job), JOB_TIMEOUT_MS(), job.type);
  } catch (e) {
    error = e;
  }
  try {
    if (error === null) {
      await dbStep(completeJob(job.id), "la clôture du job");
      console.log(`[worker] ✓ job ${job.id} ${job.type} en ${Date.now() - started} ms`);
      return;
    }
    const msg = errorMessage(error);
    const final = await dbStep(failJob(job, msg), "l'enregistrement de l'échec");
    console.error(`[worker] ✗ job ${job.id} (${job.type}) a échoué${final ? " définitivement" : ""} : ${msg}`);
    if (final) {
      const step = STEP_LABEL[job.type] ?? "une étape";
      await logEvent(job.campaignId, "error", job.type, `⚠️ Échec de ${step} après plusieurs tentatives.`, { tech: { jobId: job.id, error: msg } });
    }
  } catch (e) {
    // Base injoignable : le job reste « en cours » et sera remis en file par recoverStaleJobs.
    console.error(`[worker] job ${job.id} (${job.type}) : issue non enregistrée — ${errorMessage(e)}`);
  }
}

/** Réserve le prochain job ; null si la file est vide ou si la base ne répond pas. */
async function claimNext(): Promise<Job | null> {
  try {
    return await dbStep(claimJob(workerId), "la réservation d'un job");
  } catch (e) {
    console.error("[worker] réservation impossible :", errorMessage(e));
    return null;
  }
}

/** Traite des jobs jusqu'à épuisement de la file ou de l'échéance (mode serverless / cron). */
export async function tick({ maxJobs = 50, deadlineMs = 50_000, concurrency = config.worker.concurrency } = {}) {
  const deadline = Date.now() + deadlineMs;
  let processed = 0;
  await dbStep(recoverStaleJobs(STALE_MINUTES()), "la récupération des jobs orphelins");
  await dbStep(maybeScheduleInboxSync(), "la planification de la lecture des boîtes");
  const lanes = Array.from({ length: concurrency }, async () => {
    while (processed < maxJobs && Date.now() < deadline) {
      const job = await claimNext();
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
        const job = await claimNext();
        if (!job) {
          await dbStep(maybeScheduleInboxSync(), "la planification de la lecture des boîtes").catch(() => {});
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
