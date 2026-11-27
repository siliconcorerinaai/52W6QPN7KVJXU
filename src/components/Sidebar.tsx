"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { BRAND } from "@/lib/brand";
import { Inbox, LayoutDashboard, LogOut, Plus, Settings, ShieldCheck, Target, Radar } from "lucide-react";

const NAV = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campagnes", icon: Target },
  { href: "/inbox", label: "Réponses", icon: Inbox },
  { href: "/settings", label: "Paramètres", icon: Settings },
];
const ADMIN_NAV = { href: "/admin", label: "Administration", icon: ShieldCheck };

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login";
}

export function Sidebar({ demo, admin, account }: { demo: boolean; admin: boolean; account: { email: string; name: string } }) {
  const path = usePathname();
  const nav = admin ? [...NAV, ADMIN_NAV] : NAV;
  const toHandle = useRepliesToHandle(path);
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow">
          <Radar className="size-4.5" />
        </div>
        <div>
          <div className="font-semibold leading-tight text-slate-900">{BRAND.name}</div>
          <div className="text-[11px] leading-tight text-slate-500">{BRAND.tagline}</div>
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
                {href === "/inbox" && toHandle > 0 && (
                  <span className="ml-auto rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">{toHandle}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto space-y-3 p-4">
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
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
          <div className="min-w-0">
            {account.name && <div className="truncate text-xs font-medium text-slate-800">{account.name}</div>}
            <div className="truncate text-[11px] text-slate-500">{account.email}</div>
          </div>
          <button onClick={logout} className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Se déconnecter" title="Se déconnecter">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

/** Nombre de réponses de prospects à traiter (rafraîchi chaque minute et à chaque changement de page). */
function useRepliesToHandle(path: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/replies/count")
        .then((r) => (r.ok ? r.json() : { count: 0 }))
        .then((j) => !stop && setN(j.count ?? 0))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    // La page Réponses prévient quand une réponse change d'état (envoyée, traitée…).
    window.addEventListener("replies:changed", load);
    return () => {
      stop = true;
      clearInterval(t);
      window.removeEventListener("replies:changed", load);
    };
  }, [path]);
  return n;
}

export function MobileNav({ admin }: { admin: boolean }) {
  const toHandle = useRepliesToHandle(usePathname());
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
      <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
        <Radar className="size-5 text-brand-600" /> {BRAND.name}
      </Link>
      <div className="flex items-center gap-1 text-sm">
        <Link href="/campaigns" className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Campagnes">
          <Target className="size-4" />
        </Link>
        <Link href="/inbox" className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Réponses">
          <Inbox className="size-4" />
          {toHandle > 0 && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-brand-600" />}
        </Link>
        <Link href="/settings" className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Paramètres">
          <Settings className="size-4" />
        </Link>
        {admin && (
          <Link href="/admin" className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Administration">
            <ShieldCheck className="size-4" />
          </Link>
        )}
        <button onClick={logout} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Se déconnecter">
          <LogOut className="size-4" />
        </button>
        <Link href="/campaigns/new" className="ml-1 inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-brand-600 px-2.5 py-1.5 text-white">
          <Plus className="size-4" /> Nouveau
        </Link>
      </div>
    </div>
  );
}
