import { handle, json } from "@/lib/api";
import { countNewReplies } from "@/lib/pipeline/replies";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Nombre de réponses à traiter (pastille du menu). */
export async function GET() {
  return handle(async () => json({ count: await countNewReplies(await requireUser()) }));
}
