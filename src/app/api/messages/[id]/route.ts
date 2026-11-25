import { z } from "zod";
import { handle, json, type IdParams } from "@/lib/api";
import { getOwnedMessage, updateMessage } from "@/lib/pipeline/campaigns";
import { requireUser } from "@/lib/session";

const Patch = z.object({ subject: z.string().min(1).optional(), body: z.string().min(1).optional() });

export async function PATCH(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    await getOwnedMessage(id, await requireUser());
    await updateMessage(id, Patch.parse(await req.json()));
    return json({ ok: true });
  });
}
