import { desc } from "drizzle-orm";
import { z } from "zod";
import { handle, json } from "@/lib/api";
import { isAdmin } from "@/lib/access";
import { config, providerStatus } from "@/lib/config";
import { getDb, dbDriver } from "@/lib/db";
import { suppressions } from "@/lib/db/schema";
import { getSenderAddress, setSenderAddress } from "@/lib/outreach/sender";

export const dynamic = "force-dynamic";

/** Réglages : les utilisateurs ne reçoivent que ce qui les concerne, jamais la configuration technique. */
export async function GET() {
  return handle(async () => {
    const db = await getDb();
    const list = await db.select().from(suppressions).orderBy(desc(suppressions.createdAt)).limit(500);
    const base = { demoMode: config.demoMode, senderAddress: await getSenderAddress(), suppressions: list };
    if (!(await isAdmin())) return json(base);
    return json({
      ...base,
      database: dbDriver(),
      providers: providerStatus(),
      smtp: {
        configured: config.smtp.configured,
        host: config.smtp.host,
        senderEmail: config.smtp.senderEmail,
        senderName: config.smtp.senderName,
        dailyLimit: config.smtp.dailyLimit,
      },
      worker: { embedded: config.worker.embedded, concurrency: config.worker.concurrency },
    });
  });
}

const Patch = z.object({ senderAddress: z.string().max(300) });

export async function PATCH(req: Request) {
  return handle(async () => {
    const body = Patch.parse(await req.json());
    await setSenderAddress(body.senderAddress);
    return json({ senderAddress: await getSenderAddress() });
  });
}
