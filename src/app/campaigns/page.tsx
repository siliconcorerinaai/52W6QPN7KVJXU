import Link from "next/link";
import { Plus, Target } from "lucide-react";
import { listCampaigns } from "@/lib/pipeline/campaigns";
import { CampaignList } from "@/components/CampaignList";
import { Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await listCampaigns(await requireUser());
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campagnes</h1>
          <p className="text-sm text-slate-500">Chaque campagne est un agent qui prospecte en continu pour un profil client.</p>
        </div>
        <Link href="/campaigns/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
          <Plus className="size-4" /> Nouvelle recherche
        </Link>
      </div>
      {campaigns.length ? (
        <CampaignList items={campaigns} />
      ) : (
        <Card>
          <EmptyState icon={<Target className="size-5" />} title="Aucune campagne" text="Lancez votre première recherche en décrivant votre client idéal." />
        </Card>
      )}
    </div>
  );
}
