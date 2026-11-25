import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Chaque fichier de test a sa propre base PGlite en mémoire
    pool: "forks",
    env: { PGLITE_DIR: "memory://", EMBEDDED_WORKER: "false" },
  },
});
