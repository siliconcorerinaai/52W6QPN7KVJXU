import Link from "next/link";
import { ArrowRight, Building2, Mail, Users } from "lucide-react";
import { CampaignStatusBadge } from "./badges";
import { Card, Progress } from "./ui";
import type { CampaignStats } from "@/lib/pipeline/campaigns";

type Item = {
  id: string;
  name: string;
  prompt: string;
  status: string;
  createdAt: Date | string;
  settings: { targetCompanies: number };
  stats: CampaignStats;
};

export function CampaignList({ items }: { items: Item[] }) {
  return (
    <div className="grid gap-3">
      {items.map((c) => {
        const progress = Math.round((c.stats.qualified / Math.max(1, c.settings.targetCompanies)) * 100);
        return (
          <Link key={c.id} href={`/campaigns/${c.id}`} className="group">
            <Card className="p-4 transition-shadow group-hover:shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-slate-900">{c.name}</h3>
                    <CampaignStatusBadge status={c.status} />
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">« {c.prompt} »</p>
                </div>
                <div className="flex items-center gap-5 text-sm text-slate-600">
                  <span className="flex items-center gap-1.5" title="Entreprises qualifiées">
                    <Building2 className="size-4 text-slate-400" />
                    {c.stats.qualified}/{c.settings.targetCompanies}
                  </span>
                  <span className="flex items-center gap-1.5" title="Décideurs">
                    <Users className="size-4 text-slate-400" />
                    {c.stats.contacts}
                  </span>
                  <span className="flex items-center gap-1.5" title="Emails trouvés">
                    <Mail className="size-4 text-slate-400" />
                    {c.stats.withEmail}
                  </span>
                  <ArrowRight className="size-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                </div>
              </div>
              <Progress value={progress} className="mt-3" />
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
