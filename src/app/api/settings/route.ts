import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { handle, json } from "@/lib/api";
import { config, providerStatus } from "@/lib/config";
import { getDb, dbDriver } from "@/lib/db";
import { suppressions } from "@/lib/db/schema";
import { getSenderAddress, setSenderAddress } from "@/lib/outreach/sender";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Réglages du compte. Les clients ne reçoivent jamais la configuration technique de la plateforme. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const db = await getDb();
    const list = await db
      .select()
      .from(suppressions)
      .where(eq(suppressions.userId, user.id))
      .orderBy(desc(suppressions.createdAt))
      .limit(500);
    const base = {
      demoMode: config.demoMode,
      senderAddress: await getSenderAddress(user.id),
      suppressions: list,
      account: { email: user.email, name: user.name },
    };
    if (user.role !== "admin") return json(base);
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
    const user = await requireUser();
    const body = Patch.parse(await req.json());
    await setSenderAddress(user.id, body.senderAddress);
    return json({ senderAddress: await getSenderAddress(user.id) });
  });
}
