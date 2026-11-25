import { handle, json } from "@/lib/api";
import { config } from "@/lib/config";
import { tick } from "@/lib/jobs/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Mode serverless (Vercel…) : un cron appelle cette route pour faire avancer la file.
 * Protégée par CRON_SECRET (en-tête Authorization: Bearer <secret>).
 */
async function run(req: Request) {
  return handle(async () => {
    if (config.cronSecret && req.headers.get("authorization") !== `Bearer ${config.cronSecret}`) {
      return json({ error: "Non autorisé" }, 401);
    }
    const processed = await tick({ deadlineMs: 240_000, maxJobs: 200 });
    return json({ processed });
  });
}

export const GET = run;
export const POST = run;
