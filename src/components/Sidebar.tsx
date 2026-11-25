"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LayoutDashboard, Plus, Settings, ShieldCheck, Target, Radar } from "lucide-react";

const NAV = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campagnes", icon: Target },
  { href: "/settings", label: "Paramètres", icon: Settings },
];
const ADMIN_NAV = { href: "/admin", label: "Administration", icon: ShieldCheck };

export function Sidebar({ demo, admin }: { demo: boolean; admin: boolean }) {
  const path = usePathname();
  const nav = admin ? [...NAV, ADMIN_NAV] : NAV;
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow">
          <Radar className="size-4.5" />
        </div>
        <div>
          <div className="font-semibold leading-tight text-slate-900">Prospecta</div>
          <div className="text-[11px] leading-tight text-slate-500">Agent de prospection IA</div>
        </div>
      </div>
      <div className="px-3">
        <Link
          href="/campaigns/new"
          className="mb-4 flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
        >
          <Plus className="size-4" /> Nouvelle recherche
        </Link>
        <nav className="space-y-0.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href) && !path.startsWith("/campaigns/new");
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium",
                  active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto p-4">
        {demo ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-semibold">Mode démonstration</div>
            {admin ? "Données simulées : configurez l'agent dans l'administration pour prospecter pour de vrai." : "Les résultats affichés sont des exemples simulés."}
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <div className="font-semibold">Agent actif</div>
            Recherche en direct activée.
          </div>
        )}
      </div>
    </aside>
  );
}

export function MobileNav({ admin }: { admin: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
      <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
        <Radar className="size-5 text-brand-600" /> Prospecta
      </Link>
      <div className="flex items-center gap-1 text-sm">
        <Link href="/campaigns" className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Campagnes">
          <Target className="size-4" />
        </Link>
        <Link href="/settings" className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Paramètres">
          <Settings className="size-4" />
        </Link>
        {admin && (
          <Link href="/admin" className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Administration">
            <ShieldCheck className="size-4" />
          </Link>
        )}
        <Link href="/campaigns/new" className="ml-1 inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-brand-600 px-2.5 py-1.5 text-white">
          <Plus className="size-4" /> Nouveau
        </Link>
      </div>
    </div>
  );
}
