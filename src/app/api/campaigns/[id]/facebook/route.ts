import { z } from "zod";
import { handle, json, type IdParams } from "@/lib/api";
import { kickWorker } from "@/lib/jobs/kick";
import { audienceRows, generateAdCopy, META_MIN_AUDIENCE, savedAdCopy } from "@/lib/pipeline/ads";
import { getOwnedCampaign } from "@/lib/pipeline/campaigns";
import { facebookBoard, prepareFacebook, rewriteSocialMessage, setFacebookUrl } from "@/lib/pipeline/social";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Onglet Facebook : pages, messages à envoyer, et volet publicité (audience, textes d'annonce). */
export async function GET(_req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    await getOwnedCampaign(id, user);
    const [board, adCopy, campaignAudience, allAudience] = await Promise.all([
      facebookBoard(id, user),
      savedAdCopy(id),
      audienceRows(user, id),
      audienceRows(user, null),
    ]);
    kickWorker();
    return json({ ...board, ads: { adCopy, campaign: campaignAudience.length, all: allAudience.length, min: META_MIN_AUDIENCE } });
  });
}

const Post = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare") }),
  z.object({ action: z.literal("setUrl"), companyId: z.string(), url: z.string().max(500) }),
  z.object({ action: z.literal("rewrite"), companyId: z.string() }),
  z.object({ action: z.literal("adcopy") }),
]);

export async function POST(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    await getOwnedCampaign(id, await requireUser());
    const body = Post.parse(await req.json());
    let result: Record<string, unknown> = {};
    if (body.action === "prepare") result = await prepareFacebook(id);
    else if (body.action === "setUrl") result = { facebookUrl: await setFacebookUrl(id, body.companyId, body.url) };
    else if (body.action === "rewrite") await rewriteSocialMessage(id, body.companyId);
    else result = { adCopy: await generateAdCopy(id) };
    kickWorker();
    return json({ ok: true, ...result });
  });
}
