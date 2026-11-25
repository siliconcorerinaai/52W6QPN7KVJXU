"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Building2,
  CheckCircle2,
  Download,
  Mail,
  MoreHorizontal,
  Pause,
  PenLine,
  Play,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  Users,
  Webhook,
} from "lucide-react";
import { ActivityFeed, type FeedEvent } from "@/components/ActivityFeed";
import { CampaignStatusBadge, ContactStatusBadge, EmailBadge, ScoreBadge, signalIcon } from "@/components/badges";
import { CompaniesTable } from "@/components/CompaniesTable";
import { LeadDrawer } from "@/components/LeadDrawer";
import { Badge, Button, Card, EmptyState, Input, Linkedin } from "@/components/ui";
import type { Campaign, Company, Contact } from "@/lib/db/schema";
import type { CampaignStats } from "@/lib/pipeline/campaigns";

type Lead = {
  contact: Contact;
  company: Pick<Company, "id" | "name" | "domain" | "score" | "industry" | "location" | "country" | "signals">;
};
type CompanyRow = Omit<Company, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

const LEAD_FILTERS = [
  { id: "all", label: "Tous" },
  { id: "email", label: "Avec email" },
  { id: "drafted", label: "À valider" },
  { id: "contacted", label: "Contactés" },
  { id: "replied", label: "Réponses" },
] as const;
type LeadFilter = (typeof LEAD_FILTERS)[number]["id"];

function FunnelStep({ label, value, total, icon, highlight }: { label: string; value: number; total?: number; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={clsx("rounded-xl border p-3", highlight ? "border-brand-200 bg-brand-50/60" : "border-slate-200 bg-white")}>
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
        {value}
        {total != null && <span className="text-sm font-normal text-slate-400">/{total}</span>}
      </div>
    </div>
  );
}

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [tab, setTab] = useState<"leads" | "companies" | "plan">("leads");
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const lastEvent = useRef(0);

  const refresh = useCallback(async () => {
    const [r1, r2, r3] = await Promise.all([
      fetch(`/api/campaigns/${id}?after=${lastEvent.current}`),
      fetch(`/api/campaigns/${id}/leads`),
      fetch(`/api/campaigns/${id}/companies`),
    ]);
    if (r1.status === 404) return setNotFound(true);
    if (r1.ok) {
      const j = await r1.json();
      setCampaign(j.campaign);
      setStats(j.stats);
      if (j.events.length) {
        lastEvent.current = j.events[j.events.length - 1].id;
        setEvents((prev) => [...prev, ...j.events].slice(-400));
      }
    }
    if (r2.ok) setLeads((await r2.json()).leads);
    if (r3.ok) setCompanies((await r3.json()).companies);
  }, [id]);

  const live = campaign?.status === "running";
  const hasPendingSends = leads.some((l) => l.contact.status === "approved");

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(refresh, live || hasPendingSends ? 2500 : 10000);
    return () => clearInterval(t);
  }, [refresh, live, hasPendingSends]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  async function call(name: string, url: string, body?: object, method = "POST") {
    setBusy(name);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      await refresh();
      return json;
    } catch (e) {
      flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter(({ contact: c, company: co }) => {
      if (filter === "email" && !["valid", "risky", "catch_all"].includes(c.emailStatus)) return false;
      if (filter === "drafted" && c.status !== "drafted") return false;
      if (filter === "contacted" && !["approved", "sent"].includes(c.status)) return false;
      if (filter === "replied" && c.status !== "replied") return false;
      if (q && ![c.fullName, c.title, c.email, co.name, co.domain].some((x) => x?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [leads, filter, query]);

  const drafted = leads.filter((l) => l.contact.status === "drafted").length;
  const readyNoDraft = leads.filter((l) => l.contact.status === "ready").length;
  const selectedIds = [...selected];

  if (notFound) {
    return (
      <Card>
        <EmptyState title="Campagne introuvable" action={<Button onClick={() => router.push("/campaigns")}>Retour aux campagnes</Button>} />
      </Card>
    );
  }
  if (!campaign || !stats) return <div className="py-20 text-center text-sm text-slate-400">Chargement…</div>;

  const target = campaign.settings.targetCompanies;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{campaign.name}</h1>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">« {campaign.prompt} »</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {campaign.status === "running" && (
            <Button variant="secondary" loading={busy === "pause"} onClick={() => call("pause", `/api/campaigns/${id}`, { action: "pause" }, "PATCH")} icon={<Pause className="size-4" />}>
              Pause
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button loading={busy === "resume"} onClick={() => call("resume", `/api/campaigns/${id}`, { action: "resume" }, "PATCH")} icon={<Play className="size-4" />}>
              Reprendre
            </Button>
          )}
          {campaign.status !== "running" && (
            <Button variant="secondary" loading={busy === "more"} onClick={() => call("more", `/api/campaigns/${id}/more`, { extra: 10 }).then((r) => r && flash("L'agent repart à la recherche de 10 entreprises de plus."))} icon={<Plus className="size-4" />}>
              Trouver plus
            </Button>
          )}
          <a href={`/api/campaigns/${id}/export?type=leads`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
            <Download className="size-4" /> Export CSV
          </a>
          <div className="relative">
            <Button variant="ghost" onClick={() => setMenu((m) => !m)} aria-label="Plus d'actions">
              <MoreHorizontal className="size-4" />
            </Button>
            {menu && (
              <div className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg" onMouseLeave={() => setMenu(false)}>
                <a href={`/api/campaigns/${id}/export?type=companies`} className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-slate-50">
                  <Building2 className="size-4 text-slate-400" /> Exporter les entreprises
                </a>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-slate-50"
                  onClick={async () => {
                    setMenu(false);
                    const url = campaign.settings.webhookUrl || prompt("URL du webhook (n8n, Make, Zapier, CRM…)") || "";
                    if (!url) return;
                    const r = await call("webhook", `/api/campaigns/${id}/webhook`, { url });
                    if (r) flash(`${r.count} leads envoyés au webhook.`);
                  }}
                >
                  <Webhook className="size-4 text-slate-400" /> Envoyer vers un webhook
                </button>
                {campaign.status === "running" && (
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-slate-50"
                    onClick={() => {
                      setMenu(false);
                      call("stop", `/api/campaigns/${id}`, { action: "stop" }, "PATCH");
                    }}
                  >
                    <Square className="size-4 text-slate-400" /> Arrêter la recherche
                  </button>
                )}
                <button
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-red-600 hover:bg-red-50"
                  onClick={async () => {
                    setMenu(false);
                    if (!confirm("Supprimer définitivement cette campagne et tous ses leads ?")) return;
                    const r = await call("delete", `/api/campaigns/${id}`, undefined, "DELETE");
                    if (r) router.push("/campaigns");
                  }}
                >
                  <Trash2 className="size-4" /> Supprimer la campagne
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {notice && <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-800">{notice}</div>}

      {/* Entonnoir */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <FunnelStep label="Trouvées" value={stats.companies} icon={<Search className="size-3.5" />} />
        <FunnelStep label="Analysées" value={stats.analyzed} icon={<Building2 className="size-3.5" />} />
        <FunnelStep label="Qualifiées" value={stats.qualified} total={target} icon={<CheckCircle2 className="size-3.5" />} highlight />
        <FunnelStep label="Décideurs" value={stats.contacts} icon={<Users className="size-3.5" />} />
        <FunnelStep label="Emails" value={stats.withEmail} icon={<Mail className="size-3.5" />} highlight />
        <FunnelStep label="Vérifiés" value={stats.verified} icon={<CheckCircle2 className="size-3.5" />} />
        <FunnelStep label="Contactés" value={stats.sent} icon={<Send className="size-3.5" />} />
        <FunnelStep label="Réponses" value={stats.replied} icon={<PenLine className="size-3.5" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card className="min-w-0">
          {/* Onglets */}
          <div className="flex items-center gap-1 border-b border-slate-100 px-3 pt-2">
            {(
              [
                ["leads", `Leads (${leads.length})`],
                ["companies", `Entreprises (${companies.length})`],
                ["plan", "Ciblage"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={clsx("-mb-px border-b-2 px-3 py-2.5 text-sm font-medium", tab === k ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto hidden pr-2 text-xs text-slate-400 sm:inline" title="Coût estimé des appels IA et recherches web">
              Coût IA : {stats.costUsd.toFixed(2)} $ · {stats.webSearches} recherches
            </span>
          </div>

          {tab === "leads" && (
            <div>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {LEAD_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setFilter(f.id)}
                      className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", filter === f.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="relative ml-auto">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher…" className="h-9 w-52 pl-8" />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 bg-slate-50/70 px-4 py-2.5 text-sm">
                {selected.size > 0 ? (
                  <>
                    <span className="font-medium text-slate-700">{selected.size} sélectionné(s)</span>
                    <Button size="sm" variant="secondary" loading={busy === "write-sel"} onClick={() => call("write-sel", `/api/campaigns/${id}/write`, { contactIds: selectedIds }).then((r) => r && flash(`${r.queued} séquence(s) en cours de rédaction.`))} icon={<PenLine className="size-3.5" />}>
                      Rédiger / régénérer
                    </Button>
                    <Button size="sm" variant="success" loading={busy === "approve-sel"} onClick={() => call("approve-sel", `/api/campaigns/${id}/approve`, { contactIds: selectedIds }).then((r) => r && (flash(`${r.scheduled} séquence(s) planifiée(s).`), setSelected(new Set())))} icon={<Send className="size-3.5" />}>
                      Approuver l&apos;envoi
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                      Désélectionner
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-slate-500">Actions groupées :</span>
                    <Button size="sm" variant="secondary" disabled={!readyNoDraft} loading={busy === "write-all"} onClick={() => call("write-all", `/api/campaigns/${id}/write`, {}).then((r) => r && flash(`${r.queued} séquence(s) en cours de rédaction.`))} icon={<PenLine className="size-3.5" />}>
                      Rédiger les {readyNoDraft} leads prêts
                    </Button>
                    <Button size="sm" variant="success" disabled={!drafted} loading={busy === "approve-all"} onClick={() => confirm(`Approuver et planifier l'envoi de ${drafted} séquence(s) ?`) && call("approve-all", `/api/campaigns/${id}/approve`, {}).then((r) => r && flash(`${r.scheduled} séquence(s) planifiée(s).`))} icon={<Send className="size-3.5" />}>
                      Approuver les {drafted} brouillons
                    </Button>
                  </>
                )}
              </div>

              {filtered.length === 0 ? (
                <EmptyState
                  icon={<Users className="size-5" />}
                  title={leads.length ? "Aucun lead pour ce filtre" : "Les leads arrivent…"}
                  text={leads.length ? undefined : "L'agent recherche et qualifie les entreprises. Les décideurs apparaissent ici en temps réel."}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="w-10 px-4 py-2">
                          <input
                            type="checkbox"
                            className="accent-brand-600"
                            checked={filtered.length > 0 && filtered.every((l) => selected.has(l.contact.id))}
                            onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((l) => l.contact.id)) : new Set())}
                          />
                        </th>
                        <th className="px-3 py-2 font-medium">Décideur</th>
                        <th className="px-3 py-2 font-medium">Entreprise</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(({ contact: c, company: co }) => (
                        <tr key={c.id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => setOpenLead(c.id)}>
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="accent-brand-600"
                              checked={selected.has(c.id)}
                              onChange={(e) => {
                                const next = new Set(selected);
                                if (e.target.checked) next.add(c.id);
                                else next.delete(c.id);
                                setSelected(next);
                              }}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5 font-medium text-slate-900">
                              {c.fullName}
                              {c.linkedinUrl && (
                                <a href={c.linkedinUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-400 hover:text-sky-600">
                                  <Linkedin className="size-3.5" />
                                </a>
                              )}
                            </div>
                            <div className="max-w-56 truncate text-xs text-slate-500">{c.title ?? "—"}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-slate-800">{co.name}</span>
                              <ScoreBadge score={co.score} />
                            </div>
                            <div className="text-xs text-slate-500">
                              {co.domain}
                              {co.signals.length > 0 && <span className="ml-1.5" title={co.signals.map((s) => s.text).join("\n")}>{co.signals.slice(0, 3).map((s) => signalIcon(s.type)).join("")}</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            {c.email ? (
                              <div>
                                <div className="max-w-56 truncate text-slate-800">{c.email}</div>
                                <EmailBadge status={c.emailStatus} confidence={c.emailConfidence} />
                              </div>
                            ) : (
                              <EmailBadge status={c.status === "searching_email" || c.status === "new" ? "unknown" : c.emailStatus} />
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <ContactStatusBadge status={c.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "companies" && (
            <div>
              <div className="flex gap-1 border-b border-slate-100 px-4 py-3">
                {[
                  ["all", "Toutes"],
                  ["qualified", "Qualifiées"],
                  ["other", "Écartées / en cours"],
                ].map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setCompanyFilter(k)}
                    className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", companyFilter === k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <CompaniesTable companies={companies} filter={companyFilter} />
            </div>
          )}

          {tab === "plan" && (
            <div className="grid gap-5 p-5 text-sm md:grid-cols-2">
              <div className="md:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client idéal</div>
                <p className="mt-1 text-slate-800">{campaign.plan.summary}</p>
              </div>
              {(
                [
                  ["Secteurs", campaign.plan.industries],
                  ["Zones", campaign.plan.geographies],
                  ["Décideurs", campaign.plan.personas],
                  ["Mots-clés", campaign.plan.keywords],
                  ["Signaux d'achat", campaign.plan.signals],
                  ["Exclusions", campaign.plan.exclusions],
                  ["Critères de qualification", campaign.plan.qualificationCriteria],
                ] as const
              ).map(([label, values]) => (
                <div key={label}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {values.length ? values.map((v) => <Badge key={v} tone="brand">{v}</Badge>) : <span className="text-slate-400">—</span>}
                  </div>
                </div>
              ))}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Taille</div>
                <p className="mt-1 text-slate-800">{campaign.plan.companySize}</p>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requêtes de recherche</div>
                <ul className="mt-1.5 space-y-1 font-mono text-xs text-slate-600">
                  {campaign.plan.searchQueries.map((q) => (
                    <li key={q}>› {q}</li>
                  ))}
                </ul>
              </div>
              <div className="md:col-span-2 grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Offre</div>
                  <p className="mt-1 text-slate-800">{campaign.offer.product || "—"}</p>
                  <p className="text-slate-600">{campaign.offer.valueProposition}</p>
                  {campaign.offer.bookingUrl && (
                    <a href={campaign.offer.bookingUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-600 hover:underline">
                      📅 {campaign.offer.bookingUrl}
                    </a>
                  )}
                </div>
                <div className="text-slate-600">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Réglages</div>
                  <p className="mt-1">
                    Objectif {campaign.settings.targetCompanies} entreprises · {campaign.settings.contactsPerCompany} décideur(s) · score ≥ {campaign.settings.minScore}
                  </p>
                  <p>
                    Séquence de {campaign.settings.sequenceSteps} emails · relance tous les {campaign.settings.followUpDays} j · recherche approfondie{" "}
                    {campaign.settings.deepResearch ? "activée" : "désactivée"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="h-[640px] overflow-hidden xl:sticky xl:top-6">
          <ActivityFeed events={events} live={live} />
        </Card>
      </div>

      {openLead && <LeadDrawer contactId={openLead} onClose={() => setOpenLead(null)} onChanged={refresh} />}
    </div>
  );
}
