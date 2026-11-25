import { z } from "zod";
import { intelligence } from "@/lib/ai";
import { handle, json } from "@/lib/api";
import { CampaignOfferSchema } from "@/lib/types";

export const maxDuration = 120;

const Body = z.object({ prompt: z.string().min(8, "Décrivez votre client idéal en une phrase"), offer: CampaignOfferSchema.partial().default({}) });

/** Transforme la phrase « client idéal » en plan de prospection structuré. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const plan = await intelligence().plan({ prompt: body.prompt, offer: { ...CampaignOfferSchema.parse({}), ...body.offer } }, {});
    return json({ plan });
  });
}
