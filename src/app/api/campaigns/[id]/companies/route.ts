import { handle, json, type IdParams } from "@/lib/api";
import { listCompanies } from "@/lib/pipeline/campaigns";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    return json({ companies: await listCompanies(id) });
  });
}
