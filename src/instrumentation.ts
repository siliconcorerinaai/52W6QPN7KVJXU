/** Démarre le worker embarqué au lancement du serveur Next.js (runtime Node uniquement). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { config } = await import("@/lib/config");
  if (!config.worker.embedded || process.env.VERCEL || process.env.SERVERLESS === "true") return;
  const { startWorker } = await import("@/lib/jobs/worker");
  startWorker();
}
