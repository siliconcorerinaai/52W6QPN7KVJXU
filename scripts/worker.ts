/**
 * Worker autonome : `npm run worker`.
 * À utiliser avec une base Postgres (DATABASE_URL) et EMBEDDED_WORKER=false côté serveur web.
 */
import nextEnv from "@next/env";
import { startWorker } from "../src/lib/jobs/worker";

nextEnv.loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  console.warn("⚠️  Sans DATABASE_URL, la base PGlite ne peut pas être partagée avec le serveur web : utilisez le worker embarqué.");
}
const state = startWorker();
const stop = () => {
  console.log("[worker] arrêt demandé…");
  state.stop();
  setTimeout(() => process.exit(0), 2000);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
