"use client";

import { useEffect, useState } from "react";
import { Database, KeyRound } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { ProvidersCard, type Provider } from "@/components/ProvidersCard";

type AdminSettings = {
  demoMode: boolean;
  database: string;
  providers: Provider[];
  worker: { embedded: boolean; concurrency: number };
};

/** Administration : configuration technique, visible du seul propriétaire. */
export function AdminPanel() {
  const [s, setS] = useState<AdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.providers) throw new Error(data.error ?? "Accès réservé à l'administrateur.");
        setS(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <div className="py-20 text-center text-sm text-red-600">{error}</div>;
  if (!s) return <div className="py-20 text-center text-sm text-slate-400">Chargement…</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="text-sm text-slate-500">Visible de vous seul. Les utilisateurs ne voient ni les fournisseurs, ni les coûts, ni les erreurs techniques.</p>
      </div>

      {s.demoMode && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Mode démo actif.</strong> Les résultats sont simulés et aucun email n&apos;est envoyé. Renseignez{" "}
          <code className="font-mono">ANTHROPIC_API_KEY</code> ou <code className="font-mono">OPENROUTER_API_KEY</code> pour activer l&apos;agent réel.
        </div>
      )}

      <ProvidersCard providers={s.providers} />

      <Card>
        <CardHeader title="Accès" icon={<KeyRound className="size-4" />} />
        <div className="space-y-2 p-5 text-sm text-slate-600">
          <p>
            <code className="font-mono text-xs">ADMIN_PASSWORD</code> : votre mot de passe, qui ouvre cette page. <code className="font-mono text-xs">APP_PASSWORD</code> :
            celui que vous donnez aux utilisateurs.
          </p>
          <p>Les clés et réglages techniques se changent dans les variables d&apos;environnement de l&apos;hébergement, puis par un redéploiement.</p>
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
