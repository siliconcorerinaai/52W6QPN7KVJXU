/** Démarre le worker embarqué au lancement du serveur Next.js (runtime Node uniquement). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { config } = await import("@/lib/config");
  if (!config.worker.embedded || process.env.VERCEL) return;
  const { startWorker } = await import("@/lib/jobs/worker");
  startWorker();
}
