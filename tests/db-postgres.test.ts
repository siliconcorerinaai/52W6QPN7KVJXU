import net from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

/**
 * Test sur un vrai PostgreSQL (TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/base) :
 * une connexion qui devient muette pendant une inactivité ne doit pas bloquer les requêtes suivantes.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Postgres : connexion coupée en silence", () => {
  const sockets: { client: net.Socket; upstream: net.Socket; mute: boolean }[] = [];
  let server: net.Server | undefined;

  afterAll(async () => {
    const { resetDb } = await import("@/lib/db");
    await resetDb("fin du test");
    for (const s of sockets) {
      s.client.destroy();
      s.upstream.destroy();
    }
    server?.close();
  });

  it("vérifie la connexion après une inactivité et repart sur un pool neuf", async () => {
    const target = new URL(url!);
    // Relais TCP : on peut rendre muettes les connexions existantes, comme un réseau qui les perd.
    server = net.createServer((client) => {
      const upstream = net.connect(Number(target.port || 5432), target.hostname);
      const pair = { client, upstream, mute: false };
      sockets.push(pair);
      client.on("data", (d) => !pair.mute && upstream.write(d));
      upstream.on("data", (d) => !pair.mute && client.write(d));
      client.on("error", () => {});
      upstream.on("error", () => {});
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;

    const proxied = new URL(url!);
    proxied.hostname = "127.0.0.1";
    proxied.port = String(port);
    process.env.DATABASE_URL = proxied.toString();
    process.env.DB_IDLE_CHECK_MS = "300";
    process.env.DB_POOL_SIZE = "2";

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    await db.execute(sql`select 1`);

    for (const s of sockets) s.mute = true; // connexions mortes, sans fermeture
    await new Promise((r) => setTimeout(r, 400)); // inactivité

    const started = Date.now();
    const fresh = await getDb();
    const res = await fresh.execute(sql`select 2 as n`);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(fresh).not.toBe(db);
    expect((res as unknown as { n: number }[])[0].n).toBe(2);
  });
});
