"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { CompanyStatusBadge, ScoreBadge, signalIcon } from "./badges";
import { Badge, EmptyState, Linkedin } from "./ui";
import type { Company } from "@/lib/db/schema";

type Row = Omit<Company, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

export function CompaniesTable({ companies, filter }: { companies: Row[]; filter: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = companies.filter((c) => (filter === "all" ? true : filter === "qualified" ? c.status === "qualified" : c.status !== "qualified"));
  if (!rows.length) return <EmptyState title="Aucune entreprise pour l'instant" text="Elles apparaîtront ici au fil de la recherche." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="w-8 px-3 py-2" />
            <th className="px-3 py-2 font-medium">Entreprise</th>
            <th className="px-3 py-2 font-medium">Score</th>
            <th className="px-3 py-2 font-medium">Statut</th>
            <th className="hidden px-3 py-2 font-medium lg:table-cell">Secteur</th>
            <th className="hidden px-3 py-2 font-medium md:table-cell">Localisation</th>
            <th className="hidden px-3 py-2 font-medium md:table-cell">Effectif</th>
            <th className="px-3 py-2 font-medium">Signaux</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <Fragment key={c.id}>
              <tr className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => setOpen(open === c.id ? null : c.id)}>
                <td className="px-3 py-2.5 text-slate-400">{open === c.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-slate-900">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.domain}</div>
                </td>
                <td className="px-3 py-2.5">
                  <ScoreBadge score={c.score} />
                </td>
                <td className="px-3 py-2.5">
                  <CompanyStatusBadge status={c.status} />
                </td>
                <td className="hidden max-w-48 truncate px-3 py-2.5 text-slate-600 lg:table-cell">{c.industry ?? "—"}</td>
                <td className="hidden px-3 py-2.5 text-slate-600 md:table-cell">{[c.location, c.country].filter((x) => x && x !== "inconnu").join(", ") || "—"}</td>
                <td className="hidden px-3 py-2.5 text-slate-600 md:table-cell">{c.employeeRange ?? "—"}</td>
                <td className="px-3 py-2.5">{c.signals.length ? <span title={c.signals.map((s) => s.text).join("\n")}>{c.signals.slice(0, 4).map((s) => signalIcon(s.type)).join(" ")}</span> : <span className="text-slate-300">—</span>}</td>
              </tr>
              {open === c.id && (
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <td />
                  <td colSpan={7} className="px-3 py-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-3">
                        {c.description && <p className="text-slate-700">{c.description}</p>}
                        {c.discoveryReason && (
                          <p className="text-xs text-slate-500">
                            <span className="font-medium">Trouvée car :</span> {c.discoveryReason}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-3 text-xs">
                          {c.website && (
                            <a href={c.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                              <ExternalLink className="size-3" /> Site
                            </a>
                          )}
                          {c.linkedinUrl && (
                            <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                              <Linkedin className="size-3" /> LinkedIn
                            </a>
                          )}
                          {c.emailPattern && <span className="text-slate-500">Format email : {c.emailPattern}@{c.domain}</span>}
                        </div>
                        {c.techStack.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {c.techStack.map((t) => (
                              <Badge key={t}>{t}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-3">
                        {c.scoreReasons.length > 0 && (
                          <div>
                            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Analyse</div>
                            <ul className="list-disc space-y-0.5 pl-4 text-slate-700">
                              {c.scoreReasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {c.signals.length > 0 && (
                          <div>
                            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Signaux d&apos;achat</div>
                            <ul className="space-y-1 text-slate-700">
                              {c.signals.map((s) => (
                                <li key={s.text}>
                                  {signalIcon(s.type)} {s.text}
                                  {s.source && (
                                    <a href={s.source} target="_blank" rel="noreferrer" className="ml-1 text-xs text-brand-600 hover:underline">
                                      source
                                    </a>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {c.error && <p className="text-xs text-red-600">Erreur : {c.error}</p>}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
