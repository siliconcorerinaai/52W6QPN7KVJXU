import { desc } from "drizzle-orm";
import { handle, json } from "@/lib/api";
import { config, providerStatus } from "@/lib/config";
import { getDb, dbDriver } from "@/lib/db";
import { suppressions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const db = await getDb();
    const list = await db.select().from(suppressions).orderBy(desc(suppressions.createdAt)).limit(500);
    return json({
      demoMode: config.demoMode,
      database: dbDriver(),
      providers: providerStatus(),
      smtp: {
        configured: config.smtp.configured,
        host: config.smtp.host,
        senderEmail: config.smtp.senderEmail,
        senderName: config.smtp.senderName,
        senderAddress: config.smtp.senderAddress,
        dailyLimit: config.smtp.dailyLimit,
      },
      worker: { embedded: config.worker.embedded, concurrency: config.worker.concurrency },
      suppressions: list,
    });
  });
}
