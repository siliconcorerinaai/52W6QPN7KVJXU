import { handle, json, type IdParams } from "@/lib/api";
import { getOwnedReply, getReplyDetail, triageReply } from "@/lib/pipeline/replies";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Relance l'analyse de la réponse et régénère le brouillon. */
export async function POST(_req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const owner = await requireUser();
    await getOwnedReply(id, owner);
    await triageReply(id);
    return json(await getReplyDetail(id, owner));
  });
}
