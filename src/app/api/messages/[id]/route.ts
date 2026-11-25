import { z } from "zod";
import { handle, json, type IdParams } from "@/lib/api";
import { updateMessage } from "@/lib/pipeline/campaigns";

const Patch = z.object({ subject: z.string().min(1).optional(), body: z.string().min(1).optional() });

export async function PATCH(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    await updateMessage(id, Patch.parse(await req.json()));
    return json({ ok: true });
  });
}
