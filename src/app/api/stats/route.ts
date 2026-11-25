import { handle, json } from "@/lib/api";
import { globalStats } from "@/lib/pipeline/campaigns";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => json(await globalStats()));
}
