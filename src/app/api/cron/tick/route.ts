import { after } from "next/server";
import { handle, json } from "@/lib/api";
import { config } from "@/lib/config";
import { tick } from "@/lib/jobs/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Mode serverless : un cron (Vercel Cron, Supabase pg_cron…) appelle cette route chaque minute.
 * Elle répond tout de suite puis traite la file après la réponse : pendant 60 s elle prend de
 * nouvelles tâches, et laisse le reste de la durée maximale aux tâches longues déjà lancées.
 * Protégée par CRON_SECRET (en-tête Authorization: Bearer <secret>) quand il est défini.
 */
async function run(req: Request) {
  return handle(async () => {
    if (config.cronSecret && req.headers.get("authorization") !== `Bearer ${config.cronSecret}`) {
      return json({ error: "Non autorisé" }, 401);
    }
    after(async () => {
      try {
        await tick({ deadlineMs: 60_000, maxJobs: 200 });
      } catch (e) {
        console.error("[cron]", e);
      }
    });
    return json({ ok: true });
  });
}

export const GET = run;
export const POST = run;
