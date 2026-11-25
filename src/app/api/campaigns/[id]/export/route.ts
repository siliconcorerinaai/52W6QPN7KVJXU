import { handle, type IdParams } from "@/lib/api";
import { companiesToCsv, leadsToCsv, loadLeads } from "@/lib/pipeline/export";
import { getCampaign } from "@/lib/pipeline/campaigns";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const campaign = await getCampaign(id);
    const type = new URL(req.url).searchParams.get("type") === "companies" ? "companies" : "leads";
    const csv = type === "companies" ? await companiesToCsv(id) : leadsToCsv(await loadLeads(id));
    const slug = (campaign?.name ?? "campagne").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-${type}.csv"`,
      },
    });
  });
}
