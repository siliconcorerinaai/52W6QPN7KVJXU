"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, MapPin, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Textarea } from "@/components/ui";
import { MailboxesCard } from "@/components/MailboxesCard";

type Settings = {
  demoMode: boolean;
  senderAddress: string;
  suppressions: { value: string; reason: string; createdAt: string }[];
};

/** Adresse postale ajoutée en pied de chaque email (obligatoire en prospection). */
function SenderAddressCard({ initial, onSaved }: { initial: string; onSaved: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setValue(initial), [initial]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderAddress: value }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Adresse de l'expéditeur"
        subtitle="Adresse postale de votre entreprise, ajoutée en bas de chaque email (obligatoire en prospection)."
        icon={<MapPin className="size-4" />}
      />
      <div className="flex flex-col gap-2 p-5 sm:flex-row">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Acme SAS, 12 rue de la Paix, 75002 Paris" />
        <Button variant="secondary" onClick={save} loading={saving} disabled={value.trim() === initial.trim()}>
          Enregistrer
        </Button>
      </div>
      {!initial && !saved && <p className="px-5 pb-4 text-xs text-amber-700">À renseigner avant le premier envoi.</p>}
      {saved && <p className="px-5 pb-4 text-xs text-emerald-700">Adresse enregistrée.</p>}
    </Card>
  );
}

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
        <p className="text-sm text-slate-500">Vos boîtes d&apos;envoi, votre adresse d&apos;expéditeur et les contacts à ne jamais solliciter.</p>
      </div>

      {s.demoMode && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Mode démonstration.</strong> Les entreprises, personnes et emails affichés sont des exemples simulés, et aucun email n&apos;est
          réellement envoyé.
        </div>
      )}

      <MailboxesCard demo={s.demoMode} />

      <SenderAddressCard initial={s.senderAddress} onSaved={load} />

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
    </div>
  );
}
