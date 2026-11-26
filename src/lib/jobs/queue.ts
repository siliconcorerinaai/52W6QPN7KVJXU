import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, rowsOf } from "@/lib/db";
import { campaigns, jobs, type Job } from "@/lib/db/schema";

export type JobType =
  | "campaign.discover"
  | "company.research"
  | "company.contacts"
  | "company.visual"
  | "contact.email"
  | "contact.write"
  | "message.send"
  | "mailbox.sync"
  | "campaign.supervise";

export type EnqueueOptions = {
  campaignId?: string | null;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
};

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: EnqueueOptions = {}) {
  const db = await getDb();
  const [row] = await db
    .insert(jobs)
    .values({
      type,
      payload,
      campaignId: opts.campaignId ?? null,
      priority: opts.priority ?? 0,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
    })
    .returning({ id: jobs.id });
  return row.id;
}

/**
 * Réserve atomiquement le prochain job exécutable.
 * Les jobs d'une campagne en pause ne sont pas pris (ils attendent la reprise).
 */
export async function claimJob(workerId: string): Promise<Job | null> {
  const db = await getDb();
  const res = await db.execute(sql`
    UPDATE ${jobs} SET status = 'running', locked_at = now(), locked_by = ${workerId},
      attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT j.id FROM ${jobs} j
      LEFT JOIN ${campaigns} c ON c.id = j.campaign_id
      WHERE j.status = 'queued' AND j.run_at <= now()
        AND (j.campaign_id IS NULL OR c.status IN ('running', 'completed'))
      ORDER BY j.priority DESC, j.id ASC
      LIMIT 1
      FOR UPDATE OF j SKIP LOCKED
    )
    RETURNING id`);
  const id = rowsOf<{ id: number }>(res)[0]?.id;
  if (id == null) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

export async function completeJob(id: number) {
  const db = await getDb();
  await db.update(jobs).set({ status: "done", lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, id));
}

/** Échec : nouvelle tentative avec backoff exponentiel, ou échec définitif. Renvoie true si définitif. */
export async function failJob(job: Job, error: string): Promise<boolean> {
  const db = await getDb();
  const final = job.attempts >= job.maxAttempts;
  const delayMs = Math.min(15 * 60_000, 2 ** job.attempts * 15_000);
  await db
    .update(jobs)
    .set({
      status: final ? "failed" : "queued",
      lastError: error.slice(0, 2000),
      lockedAt: null,
      runAt: final ? job.runAt : new Date(Date.now() + delayMs),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
  return final;
}

/** Reporte un job sans compter de tentative (ex. quota d'envoi atteint). */
export async function rescheduleJob(job: Job, runAt: Date) {
  const db = await getDb();
  await db
    .update(jobs)
    .set({ status: "queued", runAt, lockedAt: null, attempts: Math.max(0, job.attempts - 1), updatedAt: new Date() })
    .where(eq(jobs.id, job.id));
}

/** Remet en file les jobs « running » orphelins (crash, redémarrage). */
export async function recoverStaleJobs(olderThanMinutes = 10) {
  const db = await getDb();
  await db.execute(sql`
    UPDATE ${jobs} SET status = 'queued', locked_at = NULL, updated_at = now()
    WHERE status = 'running' AND (locked_at IS NULL OR locked_at < now() - make_interval(mins => ${olderThanMinutes}))`);
}

export async function cancelCampaignJobs(campaignId: string, types?: JobType[]) {
  const db = await getDb();
  const conds = [eq(jobs.campaignId, campaignId), eq(jobs.status, "queued")];
  if (types?.length) conds.push(inArray(jobs.type, types));
  await db.update(jobs).set({ status: "cancelled", updatedAt: new Date() }).where(and(...conds));
}

export async function pendingJobCount(campaignId: string, excludeTypes: JobType[] = []): Promise<number> {
  const db = await getDb();
  const res = await db.execute(sql`
    SELECT count(*)::int AS n FROM ${jobs}
    WHERE campaign_id = ${campaignId} AND status IN ('queued', 'running')
    ${excludeTypes.length ? sql`AND type NOT IN (${sql.join(excludeTypes.map((t) => sql`${t}`), sql`, `)})` : sql``}`);
  return Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0);
}
