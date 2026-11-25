"use client";

import clsx from "clsx";
import { Activity } from "lucide-react";

export type FeedEvent = { id: number; level: string; kind: string; message: string; createdAt: string };

const DOT: Record<string, string> = {
  info: "bg-slate-300",
  success: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
};

function time(d: string) {
  return new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Fil d'activité en direct : ce que l'agent fait, étape par étape. */
export function ActivityFeed({ events, live }: { events: FeedEvent[]; live: boolean }) {
  const list = [...events].reverse();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Activity className="size-4 text-brand-600" /> Activité de l&apos;agent
        </div>
        {live && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-brand-600">
            <span className="pulse-dot size-2 rounded-full bg-brand-600" /> en direct
          </span>
        )}
      </div>
      <ol className="scroll-thin flex-1 space-y-0 overflow-y-auto px-4 py-3">
        {list.length === 0 && <li className="py-8 text-center text-sm text-slate-400">L&apos;agent démarre…</li>}
        {list.map((e) => (
          <li key={e.id} className="relative flex gap-3 pb-3">
            <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", DOT[e.level] ?? DOT.info)} />
            <div className="min-w-0">
              <p className={clsx("text-sm leading-snug", e.level === "error" ? "text-red-700" : "text-slate-700")}>{e.message}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{time(e.createdAt)}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
