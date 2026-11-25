import { z } from "zod";
import { kickWorker } from "@/lib/jobs/kick";
import { handle, json, type IdParams } from "@/lib/api";
import { getContactDetail, requestWrite, setContactStatus, updateContactEmail } from "@/lib/pipeline/campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const detail = await getContactDetail(id);
    if (!detail) return json({ error: "Contact introuvable" }, 404);
    return json(detail);
  });
}

const Patch = z.object({
  status: z.enum(["replied", "unsubscribed", "bounced", "drafted"]).optional(),
  email: z.string().email().optional(),
  rewrite: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const body = Patch.parse(await req.json());
    if (body.email) await updateContactEmail(id, body.email);
    if (body.status) await setContactStatus(id, body.status);
    if (body.rewrite) await requestWrite([id]);
    kickWorker();
    return json({ ok: true });
  });
}
