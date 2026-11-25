"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

export const EXAMPLES = [
  "Agences web en France de 10 à 50 salariés qui vendent des sites Shopify",
  "Cabinets d'expertise comptable à Lyon qui recrutent des collaborateurs",
  "Startups SaaS B2B en Europe ayant levé des fonds en 2026",
  "PME industrielles du Grand Ouest qui exportent et utilisent un ERP",
  "Écoles de commerce privées en Belgique et en Suisse",
];

/** Grande barre « Décrivez votre client idéal » de la page d'accueil. */
export function HeroSearch() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const go = (p: string) => router.push(`/campaigns/new?prompt=${encodeURIComponent(p)}`);
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-indigo-600 to-violet-700 px-6 py-10 text-white shadow-lg md:px-10">
      <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-white/10 blur-3xl" />
      <div className="relative max-w-3xl">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
          <Sparkles className="size-3.5" /> Prospection par agent IA · recherche web en direct
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Qui voulez-vous prospecter ?</h1>
        <p className="mt-2 text-white/80">
          Décrivez votre client idéal en une phrase. L&apos;agent trouve les entreprises, les qualifie, identifie les décideurs, vérifie leurs emails
          et rédige des messages personnalisés.
        </p>
        <form
          className="mt-6 flex flex-col gap-2 rounded-xl bg-white p-2 shadow-xl sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim().length > 7) go(prompt.trim());
          }}
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ex. : Agences immobilières indépendantes à Bordeaux avec plus de 5 agents"
            className="h-11 flex-1 rounded-lg px-3 text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <button className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 font-medium text-white hover:bg-brand-700">
            Lancer l&apos;agent <ArrowRight className="size-4" />
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.slice(0, 3).map((ex) => (
            <button key={ex} onClick={() => go(ex)} className="rounded-full bg-white/10 px-3 py-1 text-left text-xs text-white/90 ring-1 ring-white/20 hover:bg-white/20">
              {ex}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
