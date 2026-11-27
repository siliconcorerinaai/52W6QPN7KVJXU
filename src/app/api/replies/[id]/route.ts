import { z } from "zod";
import { handle, json, type IdParams } from "@/lib/api";
import { getReplyDetail, setReplyStatus } from "@/lib/pipeline/replies";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: IdParams) {
  return handle(async () => json(await getReplyDetail((await params).id, await requireUser())));
}

const Patch = z.object({ status: z.enum(["new", "handled"]) });

export async function PATCH(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const owner = await requireUser();
    await setReplyStatus(id, owner, Patch.parse(await req.json()).status);
    return json(await getReplyDetail(id, owner));
  });
}
