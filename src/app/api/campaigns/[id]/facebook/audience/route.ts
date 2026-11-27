import { handle, type IdParams } from "@/lib/api";
import { audienceCsv, audienceRows } from "@/lib/pipeline/ads";
import { getOwnedCampaign } from "@/lib/pipeline/campaigns";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Audience à importer dans le Gestionnaire de publicités Meta (liste de clients) : cette campagne ou toutes. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    const campaign = await getOwnedCampaign(id, user);
    const all = new URL(req.url).searchParams.get("scope") === "all";
    const csv = audienceCsv(await audienceRows(user, all ? null : id));
    const slug = all ? "toutes-campagnes" : campaign.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "campagne";
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audience-meta-${slug}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
