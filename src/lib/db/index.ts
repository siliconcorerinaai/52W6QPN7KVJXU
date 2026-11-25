import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type DbState = { db: DB; ready: Promise<void>; driver: "pglite" | "postgres" };

const globalForDb = globalThis as unknown as { __prospectaDb?: DbState };

/** Journal de migrations propre à Prospecta (n'interfère pas avec celui d'une autre application). */
const MIGRATIONS = { migrationsSchema: "prospecta", migrationsTable: "__migrations" };

/**
 * Applique les migrations, avec quelques nouvelles tentatives : en serverless, plusieurs
 * instances peuvent démarrer en même temps ; la seconde trouve alors les migrations déjà faites.
 */
async function migrateWithRetry(run: () => Promise<void>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= 4) throw e;
      console.warn(`[db] migration interrompue (tentative ${attempt}) :`, e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

/** URL Postgres : DATABASE_URL, ou POSTGRES_URL fournie par l'intégration Supabase de Vercel. */
export function databaseUrl(): string | undefined {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim() || undefined;
}

/** TLS obligatoire pour une base distante (Supabase…), sauf `sslmode=disable` ou hôte local. */
function sslFor(url: string): "require" | false {
  if (/sslmode=disable/i.test(url)) return false;
  try {
    const host = new URL(url).hostname;
    if (["localhost", "127.0.0.1", "::1"].includes(host) || host.endsWith(".railway.internal")) return false;
  } catch {
    /* URL non standard : on laisse le pilote décider */
  }
  return "require";
}

/**
 * Le pooler partagé de Supabase existe en deux grappes par région (aws-0-… et aws-1-…).
 * Si la mauvaise est configurée, Supavisor répond « Tenant or user not found » : on essaie l'autre.
 */
export function alternatePoolerUrl(url: string): string | null {
  const m = url.match(/aws-(\d+)-([a-z0-9-]+)\.pooler\.supabase\.com/);
  if (!m) return null;
  const other = m[1] === "0" ? "1" : "0";
  return url.replace(`aws-${m[1]}-${m[2]}.pooler`, `aws-${other}-${m[2]}.pooler`);
}

async function connectPostgres(url: string) {
  const { default: postgres } = await import("postgres");
  const open = (u: string) =>
    postgres(u, {
      max: Number(process.env.DB_POOL_SIZE ?? 6),
      idle_timeout: 20,
      prepare: false, // compatible avec le pooler Supabase (Supavisor)
      ssl: sslFor(u),
      onnotice: () => {},
    });
  const client = open(url);
  try {
    await client`select 1`;
    return client;
  } catch (e) {
    const alt = alternatePoolerUrl(url);
    if (!alt || !/tenant or user not found/i.test(e instanceof Error ? e.message : String(e))) throw e;
    await client.end({ timeout: 1 });
    const fallback = open(alt);
    await fallback`select 1`;
    console.warn(`[db] DATABASE_URL : utilisez le pooler ${new URL(alt).hostname} (l'autre grappe ne connaît pas ce projet).`);
    return fallback;
  }
}

async function create(): Promise<DbState> {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  const url = databaseUrl();

  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = await connectPostgres(url);
    const db = drizzle(client, { schema, casing: "snake_case" });
    const ready = migrateWithRetry(() => migrate(db, { migrationsFolder, ...MIGRATIONS }));
    return { db: db as unknown as DB, ready, driver: "postgres" };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // Sur Vercel le disque est en lecture seule : base de démonstration éphémère dans /tmp
  const dataDir = process.env.PGLITE_DIR ?? (process.env.VERCEL ? "/tmp/prospecta-pglite" : path.join(process.cwd(), "data", "pglite"));
  const inMemory = dataDir === "memory://";
  if (!inMemory) fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(inMemory ? undefined : dataDir);
  const db = drizzle(client, { schema, casing: "snake_case" });
  const ready = migrate(db, { migrationsFolder, ...MIGRATIONS });
  return { db: db as unknown as DB, ready, driver: "pglite" };
}

let pending: Promise<DbState> | undefined;


/** Renvoie la base prête à l'emploi (migrations appliquées). Singleton par process. */
export async function getDb(): Promise<DB> {
  if (!globalForDb.__prospectaDb) {
    pending ??= create().then((s) => (globalForDb.__prospectaDb = s));
    try {
      await pending;
    } catch (e) {
      pending = undefined;
      throw e;
    }
  }
  const state = globalForDb.__prospectaDb!;
  try {
    await state.ready;
  } catch (e) {
    // Échec (base injoignable, migration en conflit…) : la prochaine requête retentera
    if (globalForDb.__prospectaDb === state) {
      globalForDb.__prospectaDb = undefined;
      pending = undefined;
    }
    throw e;
  }
  return state.db;
}

export function dbDriver(): "pglite" | "postgres" {
  return databaseUrl() ? "postgres" : "pglite";
}

/** Lignes d'un `db.execute()` quel que soit le pilote (postgres-js renvoie un tableau, PGlite `{ rows }`). */
export function rowsOf<T = Record<string, unknown>>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] })?.rows ?? []) as T[];
}

export { schema };
