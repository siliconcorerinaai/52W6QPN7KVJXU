import { z } from "zod";
import { handle, json, type IdParams } from "@/lib/api";
import { getCampaign } from "@/lib/pipeline/campaigns";
import { pushWebhook } from "@/lib/pipeline/export";

const Body = z.object({ url: z.string().url().optional() });

export async function POST(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const body = Body.parse(await req.json().catch(() => ({})));
    const campaign = await getCampaign(id);
    const url = body.url || campaign?.settings.webhookUrl;
    if (!url) return json({ error: "Aucune URL de webhook" }, 400);
    const count = await pushWebhook(id, url);
    return json({ count });
  });
}
