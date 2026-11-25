"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, Circle, Database, Plug, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Textarea } from "@/components/ui";
import { MailboxesCard } from "@/components/MailboxesCard";

type Settings = {
  demoMode: boolean;
  database: string;
  providers: { id: string; label: string; enabled: boolean; detail: string }[];
  smtp: { configured: boolean; host: string; senderEmail: string; senderName: string; senderAddress: string; dailyLimit: number };
  worker: { embedded: boolean; concurrency: number };
  suppressions: { value: string; reason: string; createdAt: string }[];
};

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [toAdd, setToAdd] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/settings");
    if (res.ok) setS(await res.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function addSuppressions() {
    const values = toAdd.split(/[\s,;]+/).filter(Boolean);
    if (!values.length) return;
    await fetch("/api/suppressions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
    setToAdd("");
    load();
  }

  if (!s) return <div className="py-20 text-center text-sm text-slate-400">Chargement…</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>
        <p className="text-sm text-slate-500">
          Les clés et identifiants se configurent dans le fichier <code className="rounded bg-slate-100 px-1 font-mono text-xs">.env.local</code> (voir{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-xs">.env.example</code>), puis redémarrez le serveur.
        </p>
      </div>

      {s.demoMode && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Mode démo actif.</strong> Les entreprises, personnes et emails sont simulés (domaines en <code>.example</code>) et aucun email n&apos;est
          réellement envoyé. Renseignez <code className="font-mono">ANTHROPIC_API_KEY</code> ou <code className="font-mono">OPENROUTER_API_KEY</code> pour activer l&apos;agent réel.
        </div>
      )}

      <Card>
        <CardHeader title="Sources de données & IA" subtitle="Plus de sources = plus de leads trouvés et mieux vérifiés." icon={<Plug className="size-4" />} />
        <ul className="divide-y divide-slate-100">
          {s.providers.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="flex items-center gap-3">
                {p.enabled ? <CheckCircle2 className="size-5 text-emerald-500" /> : <Circle className="size-5 text-slate-300" />}
                <div>
                  <div className="text-sm font-medium text-slate-900">{p.label}</div>
                  <div className="text-xs text-slate-500">{p.detail}</div>
                </div>
              </div>
              <Badge tone={p.enabled ? "green" : "slate"}>{p.enabled ? "Actif" : "Inactif"}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <MailboxesCard senderAddress={s.smtp.senderAddress} demo={s.demoMode} />

      <Card>
        <CardHeader
          title="Liste d'exclusion"
          subtitle="Emails ou domaines (@concurrent.fr) jamais contactés. Les désinscriptions y sont ajoutées automatiquement."
          icon={<Ban className="size-4" />}
        />
        <div className="space-y-3 p-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Textarea rows={2} value={toAdd} onChange={(e) => setToAdd(e.target.value)} placeholder="jean@client.fr, @concurrent.com, @mon-domaine.fr" />
            <Button variant="secondary" onClick={addSuppressions} disabled={!toAdd.trim()}>
              Ajouter
            </Button>
          </div>
          {s.suppressions.length > 0 ? (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {s.suppressions.map((x) => (
                <li key={x.value} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{x.value}</span>
                  <span className="flex items-center gap-3">
                    <Badge>{x.reason === "unsubscribe" ? "désinscription" : x.reason}</Badge>
                    <button
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`Retirer ${x.value}`}
                      onClick={async () => {
                        await fetch(`/api/suppressions?value=${encodeURIComponent(x.value)}`, { method: "DELETE" });
                        load();
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Aucune exclusion.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Infrastructure" icon={<Database className="size-4" />} />
        <div className="grid gap-3 p-5 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-slate-500">Base de données</div>
            <div className="font-medium">{s.database === "postgres" ? "PostgreSQL (DATABASE_URL) — schéma prospecta" : "PGlite embarqué (./data/pglite)"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Worker</div>
            <div className="font-medium">
              {s.worker.embedded ? "Embarqué dans le serveur" : "Process séparé (npm run worker)"} · {s.worker.concurrency} tâches en parallèle
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
