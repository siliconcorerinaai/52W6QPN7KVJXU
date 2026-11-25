import Link from "next/link";
import { Building2, Mail, MessageSquareReply, Send, Sparkles, Target, Users, Wallet } from "lucide-react";
import { globalStats, listCampaigns } from "@/lib/pipeline/campaigns";
import { Card, CardHeader, EmptyState, Stat } from "@/components/ui";
import { CampaignList } from "@/components/CampaignList";
import { HeroSearch } from "@/components/HeroSearch";
import { Landing } from "@/components/Landing";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) return <Landing />;
  const admin = user.role === "admin";
  const [stats, campaigns] = await Promise.all([globalStats(user), listCampaigns(user)]);
  return (
    <div className="space-y-8">
      <HeroSearch />

      <section className={`grid grid-cols-2 gap-3 ${admin ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
        <Stat label="Campagnes" value={stats.campaigns} sub={`${stats.running} en cours`} icon={<Target className="size-4" />} />
        <Stat label="Entreprises qualifiées" value={stats.qualified} sub={`${stats.companies} analysées`} icon={<Building2 className="size-4" />} />
        <Stat label="Décideurs" value={stats.contacts} icon={<Users className="size-4" />} />
        <Stat label="Emails trouvés" value={stats.withEmail} icon={<Mail className="size-4" />} />
        <Stat label="Emails envoyés" value={stats.sent} sub={`${stats.replied} réponse(s)`} icon={<Send className="size-4" />} />
        {admin && <Stat label="Coût IA" value={`${stats.costUsd.toFixed(2)} $`} sub="estimation" icon={<Wallet className="size-4" />} />}
      </section>

      <Card>
        <CardHeader
          title="Campagnes récentes"
          icon={<Sparkles className="size-4" />}
          action={
            <Link href="/campaigns" className="text-sm font-medium text-brand-600 hover:text-brand-700">
              Tout voir
            </Link>
          }
        />
        <div className="p-4">
          {campaigns.length ? (
            <CampaignList items={campaigns.slice(0, 6)} />
          ) : (
            <EmptyState
              icon={<MessageSquareReply className="size-5" />}
              title="Aucune campagne pour l'instant"
              text="Décrivez votre client idéal ci-dessus : l'agent s'occupe de trouver les entreprises, les décideurs et leurs emails."
            />
          )}
        </div>
      </Card>
    </div>
  );
}
