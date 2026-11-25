import { z } from "zod";
import { kickWorker } from "@/lib/jobs/kick";
import { handle, json, type IdParams } from "@/lib/api";
import { findMore, getOwnedCampaign } from "@/lib/pipeline/campaigns";
import { requireUser } from "@/lib/session";

export const maxDuration = 300;

const Body = z.object({ extra: z.number().int().min(1).max(500).default(10) });

export async function POST(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    await getOwnedCampaign(id, await requireUser());
    const { extra } = Body.parse(await req.json().catch(() => ({})));
    await findMore(id, extra);
    kickWorker();
    return json({ ok: true });
  });
}
