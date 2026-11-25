import { handle, json, type IdParams } from "@/lib/api";
import { getOwnedCampaign, listLeads } from "@/lib/pipeline/campaigns";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    await getOwnedCampaign(id, await requireUser());
    return json({ leads: await listLeads(id) });
  });
}
