import { handle, json } from "@/lib/api";
import { publicStats } from "@/lib/access";
import { globalStats } from "@/lib/pipeline/campaigns";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const stats = await globalStats(user);
    return json(user.role === "admin" ? stats : publicStats(stats));
  });
}
