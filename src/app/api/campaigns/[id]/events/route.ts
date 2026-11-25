import { handle, json, type IdParams } from "@/lib/api";
import { publicEventData } from "@/lib/access";
import { campaignEvents, getOwnedCampaign } from "@/lib/pipeline/campaigns";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    await getOwnedCampaign(id, user);
    const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
    const events = await campaignEvents(id, after, 500);
    return json({ events: user.role === "admin" ? events : events.map((e) => ({ ...e, data: publicEventData(e.data) })) });
  });
}
