import { z } from "zod";
import { handle, json, type IdParams } from "@/lib/api";
import { updateSocialMessage } from "@/lib/pipeline/social";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const Patch = z.object({
  message: z.string().max(2000).optional(),
  status: z.enum(["todo", "sent", "replied", "skipped"]).optional(),
});

/** Message Facebook : texte modifié, ou état (envoyé, a répondu, ignoré, à envoyer). */
export async function PATCH(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const social = await updateSocialMessage(id, await requireUser(), Patch.parse(await req.json()));
    return json({ social });
  });
}
