import { z } from "zod";
import { kickWorker } from "@/lib/jobs/kick";
import { handle, json, type IdParams } from "@/lib/api";
import { isAdmin, publicEventData, publicStats } from "@/lib/access";
import {
  campaignEvents,
  campaignStats,
  deleteCampaign,
  getCampaign,
  updateCampaignConfig,
  updateCampaignStatus,
} from "@/lib/pipeline/campaigns";
import { CampaignOfferSchema, CampaignSettingsSchema } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return json({ error: "Campagne introuvable" }, 404);
    const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
    const [stats, events] = await Promise.all([campaignStats([id]), campaignEvents(id, after)]);
    kickWorker();
    if (await isAdmin()) return json({ campaign, stats: stats[id], events });
    return json({ campaign, stats: publicStats(stats[id]), events: events.map((e) => ({ ...e, data: publicEventData(e.data) })) });
  });
}

const Patch = z.object({
  action: z.enum(["pause", "resume", "stop"]).optional(),
  name: z.string().optional(),
  offer: CampaignOfferSchema.partial().optional(),
  settings: CampaignSettingsSchema.partial().optional(),
});

export async function PATCH(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const body = Patch.parse(await req.json());
    if (body.action) await updateCampaignStatus(id, body.action);
    if (body.name || body.offer || body.settings) await updateCampaignConfig(id, body);
    kickWorker();
    return json({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    await deleteCampaign(id);
    return json({ ok: true });
  });
}
