import { z } from "zod";
import { kickWorker } from "@/lib/jobs/kick";
import { handle, json } from "@/lib/api";
import { createCampaign, listCampaigns } from "@/lib/pipeline/campaigns";
import { CampaignOfferSchema, CampaignPlanSchema, CampaignSettingsSchema } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return handle(async () => json({ campaigns: await listCampaigns() }));
}

const Body = z.object({
  name: z.string().optional(),
  prompt: z.string().min(8),
  plan: CampaignPlanSchema,
  offer: CampaignOfferSchema.partial().default({}),
  settings: CampaignSettingsSchema.partial().default({}),
});

export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const campaign = await createCampaign(body);
    kickWorker();
    return json({ campaign }, 201);
  });
}
