"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Plug, XCircle } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";

export type Provider = { id: string; label: string; enabled: boolean; detail: string };
type KeyCheck = { id: string; ok: boolean; detail: string };

/** Fournisseurs configurés et test de leurs clés (administration). */
export function ProvidersCard({ providers }: { providers: Provider[] }) {
  const [checks, setChecks] = useState<Record<string, KeyCheck> | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function testKeys() {
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch("/api/settings/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setChecks(Object.fromEntries((data.results as KeyCheck[]).map((r) => [r.id, r])));
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Sources de données & IA"
        subtitle="Plus de sources = plus de leads trouvés et mieux vérifiés."
        icon={<Plug className="size-4" />}
        action={
          <Button variant="secondary" size="sm" onClick={testKeys} loading={checking} disabled={!providers.some((p) => p.enabled)}>
            Tester les clés
          </Button>
        }
      />
      {checkError && <p className="border-b border-slate-100 px-5 py-2 text-sm text-red-600">Test impossible : {checkError}</p>}
      <ul className="divide-y divide-slate-100">
        {providers.map((p) => {
          const check = checks?.[p.id];
          return (
            <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                {check && !check.ok ? (
                  <XCircle className="size-5 shrink-0 text-red-500" />
                ) : p.enabled ? (
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="size-5 shrink-0 text-slate-300" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">{p.label}</div>
                  <div className="text-xs text-slate-500">{p.detail}</div>
                  {check && <div className={`mt-0.5 text-xs ${check.ok ? "text-emerald-700" : "text-red-600"}`}>{check.detail}</div>}
                </div>
              </div>
              {check ? (
                <Badge tone={check.ok ? "green" : "red"}>{check.ok ? "Clé OK" : "Problème"}</Badge>
              ) : (
                <Badge tone={p.enabled ? "green" : "slate"}>{p.enabled ? "Actif" : "Inactif"}</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
