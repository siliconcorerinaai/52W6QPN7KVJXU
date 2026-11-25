import { z } from "zod";
import { kickWorker } from "@/lib/jobs/kick";
import { handle, json } from "@/lib/api";
import { publicStats } from "@/lib/access";
import { createCampaign, listCampaigns } from "@/lib/pipeline/campaigns";
import { requireUser } from "@/lib/session";
import { CampaignOfferSchema, CampaignPlanSchema, CampaignSettingsSchema } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const list = await listCampaigns(user);
    return json({ campaigns: user.role === "admin" ? list : list.map((c) => ({ ...c, stats: publicStats(c.stats) })) });
  });
}

const Body = z.object({
  name: z.string().max(200).optional(),
  prompt: z.string().min(8).max(2000),
  plan: CampaignPlanSchema,
  offer: CampaignOfferSchema.partial().default({}),
  settings: CampaignSettingsSchema.partial().default({}),
});

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = Body.parse(await req.json());
    const campaign = await createCampaign({ ...body, userId: user.id });
    kickWorker();
    return json({ campaign }, 201);
  });
}
