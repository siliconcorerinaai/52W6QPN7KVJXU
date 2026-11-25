import { z } from "zod";
import { handle, json, type IdParams } from "@/lib/api";
import { getOwnedCampaign } from "@/lib/pipeline/campaigns";
import { pushWebhook } from "@/lib/pipeline/export";
import { requireUser } from "@/lib/session";

const Body = z.object({ url: z.string().url().optional() });

export async function POST(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const campaign = await getOwnedCampaign(id, await requireUser());
    const body = Body.parse(await req.json().catch(() => ({})));
    const url = body.url || campaign.settings.webhookUrl;
    if (!url) return json({ error: "Aucune URL de webhook" }, 400);
    const count = await pushWebhook(id, url);
    return json({ count });
  });
}
