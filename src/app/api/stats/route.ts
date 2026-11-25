import { handle, json } from "@/lib/api";
import { isAdmin, publicStats } from "@/lib/access";
import { globalStats } from "@/lib/pipeline/campaigns";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const stats = await globalStats();
    return json((await isAdmin()) ? stats : publicStats(stats));
  });
}
