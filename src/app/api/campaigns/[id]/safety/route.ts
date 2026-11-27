import { z } from "zod";
import { handle, json, type IdParams } from "@/lib/api";
import { kickWorker } from "@/lib/jobs/kick";
import { SEND_POLICIES } from "@/lib/outreach/safety";
import { getOwnedCampaign } from "@/lib/pipeline/campaigns";
import { releaseHeld, safetyOverview, setSendPolicy } from "@/lib/pipeline/safety";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Règle d'envoi de la campagne, taux de rebond, emails mis de côté. */
export async function GET(_req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    await getOwnedCampaign(id, await requireUser());
    return json({ safety: await safetyOverview(id) });
  });
}

const Post = z.object({
  /** Nouvelle règle d'envoi : les emails mis de côté qu'elle accepte repartent. */
  policy: z.enum(SEND_POLICIES).optional(),
  /** « Envoyer quand même » : tous les emails mis de côté, ou ceux de ces contacts. */
  release: z.union([z.literal("all"), z.array(z.string()).max(1000)]).optional(),
});

export async function POST(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    await getOwnedCampaign(id, await requireUser());
    const body = Post.parse(await req.json());
    let released = 0;
    if (body.policy) released += (await setSendPolicy(id, body.policy)).released;
    if (body.release) released += await releaseHeld(id, { force: true, contactIds: body.release === "all" ? undefined : body.release });
    kickWorker();
    return json({ released, safety: await safetyOverview(id) });
  });
}
