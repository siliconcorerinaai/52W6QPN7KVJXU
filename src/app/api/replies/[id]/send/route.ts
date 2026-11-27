import { z } from "zod";
import { handle, json, type IdParams } from "@/lib/api";
import { getReplyDetail, sendReply } from "@/lib/pipeline/replies";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().min(2).max(10_000) });

/** Envoie notre réponse au prospect, dans la même conversation. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const owner = await requireUser();
    await sendReply(id, owner, Body.parse(await req.json()));
    return json(await getReplyDetail(id, owner));
  });
}
