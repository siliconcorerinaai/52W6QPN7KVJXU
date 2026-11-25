import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type DbState = { db: DB; ready: Promise<void>; driver: "pglite" | "postgres" };

const globalForDb = globalThis as unknown as { __prospectaDb?: DbState };

async function create(): Promise<DbState> {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  const url = process.env.DATABASE_URL?.trim();

  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, { max: Number(process.env.DB_POOL_SIZE ?? 10), prepare: false });
    const db = drizzle(client, { schema, casing: "snake_case" });
    const ready = migrate(db, { migrationsFolder });
    return { db: db as unknown as DB, ready, driver: "postgres" };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), "data", "pglite");
  const inMemory = dataDir === "memory://";
  if (!inMemory) fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(inMemory ? undefined : dataDir);
  const db = drizzle(client, { schema, casing: "snake_case" });
  const ready = migrate(db, { migrationsFolder });
  return { db: db as unknown as DB, ready, driver: "pglite" };
}

let pending: Promise<DbState> | undefined;

/** Renvoie la base prête à l'emploi (migrations appliquées). Singleton par process. */
export async function getDb(): Promise<DB> {
  if (!globalForDb.__prospectaDb) {
    pending ??= create().then((s) => (globalForDb.__prospectaDb = s));
    await pending;
  }
  const state = globalForDb.__prospectaDb!;
  await state.ready;
  return state.db;
}

export function dbDriver(): "pglite" | "postgres" {
  return process.env.DATABASE_URL?.trim() ? "postgres" : "pglite";
}

export { schema };
