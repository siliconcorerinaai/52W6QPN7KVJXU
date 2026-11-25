import { after } from "next/server";
import { tick } from "./worker";

const g = globalThis as unknown as { __prospectaKick?: boolean };

/** Hébergement serverless (Vercel…) : pas de worker permanent, la file avance pendant les requêtes et le cron. */
export const isServerless = () => Boolean(process.env.VERCEL) || process.env.SERVERLESS === "true";

/**
 * Fait avancer la file après la réponse HTTP (serverless uniquement).
 * Une seule passe à la fois par instance ; les autres instances se partagent le travail (SKIP LOCKED).
 */
export function kickWorker(deadlineMs = 45_000) {
  if (!isServerless() || g.__prospectaKick) return;
  g.__prospectaKick = true;
  after(async () => {
    try {
      await tick({ deadlineMs, maxJobs: 100 });
    } catch (e) {
      console.error("[kick]", e);
    } finally {
      g.__prospectaKick = false;
    }
  });
}
