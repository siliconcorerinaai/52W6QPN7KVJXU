import { handle, json, type IdParams } from "@/lib/api";
import { campaignEvents } from "@/lib/pipeline/campaigns";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
    return json({ events: await campaignEvents(id, after, 500) });
  });
}
