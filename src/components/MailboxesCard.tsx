"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Inbox, Mail, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Label, Toggle } from "./ui";

type Box = {
  id: string;
  source: "env" | "db";
  label: string;
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string | null;
  dailyLimit: number;
  enabled: boolean;
  sentToday: number;
  lastSyncAt: string | null;
  lastError: string | null;
};

/** Préréglages des fournisseurs courants (SMTP + IMAP). */
const PRESETS: Record<string, { smtpHost: string; smtpPort: number; smtpSecure: boolean; imapHost: string; imapPort: number; hint: string }> = {
  google: {
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    hint: "Google Workspace / Gmail : utilisez un mot de passe d'application (Compte Google → Sécurité → Mots de passe des applications).",
  },
  microsoft: {
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "outlook.office365.com",
    imapPort: 993,
    hint: "Microsoft 365 : l'authentification SMTP doit être activée pour la boîte (centre d'administration Exchange).",
  },
  zoho: {
    smtpHost: "smtp.zoho.eu",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.zoho.eu",
    imapPort: 993,
    hint: "Zoho Mail (UE) : activez l'accès IMAP dans les paramètres Zoho et utilisez un mot de passe d'application.",
  },
  ovh: {
    smtpHost: "ssl0.ovh.net",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "ssl0.ovh.net",
    imapPort: 993,
    hint: "OVHcloud (MX Plan / Email Pro) : identifiant = adresse email complète.",
  },
  other: { smtpHost: "", smtpPort: 587, smtpSecure: false, imapHost: "", imapPort: 993, hint: "Renseignez les serveurs SMTP et IMAP de votre hébergeur." },
};

const EMPTY = {
  label: "",
  fromName: "",
  fromEmail: "",
  smtpHost: PRESETS.google.smtpHost,
  smtpPort: PRESETS.google.smtpPort,
  smtpSecure: PRESETS.google.smtpSecure,
  smtpUser: "",
  smtpPass: "",
  imapHost: PRESETS.google.imapHost,
  imapPort: PRESETS.google.imapPort,
  imapSecure: true,
  dailyLimit: 40,
};

function ago(d: string | null) {
  if (!d) return "jamais";
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  return min < 1 ? "à l'instant" : min < 60 ? `il y a ${min} min` : new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/** Gestion des boîtes d'envoi : rotation, limites, test, lecture des réponses. */
export function MailboxesCard({ senderAddress, demo }: { senderAddress: string; demo: boolean }) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState("google");
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/mailboxes");
    if (res.ok) setBoxes((await res.json()).mailboxes);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function run(name: string, fn: () => Promise<Response>, ok: (j: Record<string, unknown>) => string) {
    setBusy(name);
    setNotice(null);
    try {
      const res = await fn();
      const j = await res.json().catch(() => ({}));
      setNotice(res.ok ? ok(j) : `⚠️ ${j.error ?? "Erreur"}`);
      if (res.ok) await load();
      return res.ok;
    } finally {
      setBusy(null);
    }
  }

  const post = (url: string, body?: object) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

  const totalCapacity = boxes.filter((b) => b.enabled).reduce((s, b) => s + b.dailyLimit, 0);

  return (
    <Card>
      <CardHeader
        title="Boîtes d'envoi"
        subtitle={`Rotation automatique entre les boîtes actives · capacité totale ${totalCapacity} emails / jour · jours ouvrés 8h–18h`}
        icon={<Mail className="size-4" />}
        action={
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "sync"}
              disabled={!boxes.some((b) => b.imapHost)}
              onClick={() => run("sync", () => post("/api/mailboxes/sync"), () => "Lecture des boîtes de réception lancée.")}
              icon={<RefreshCw className="size-3.5" />}
              className="whitespace-nowrap"
            >
              Lire les réponses
            </Button>
            <Button size="sm" onClick={() => setAdding((a) => !a)} icon={<Plus className="size-3.5" />}>
              Ajouter
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-5 text-sm">
        {demo && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Mode démo : aucun email n&apos;est réellement envoyé.</p>}
        {notice && <p className="rounded-lg bg-slate-50 p-3">{notice}</p>}

        {boxes.length === 0 ? (
          <p className="text-slate-500">
            Aucune boîte configurée. Ajoutez une boîte dédiée à la prospection (domaine secondaire, SPF / DKIM / DMARC configurés).
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {boxes.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium text-slate-900">
                    {b.enabled ? <CheckCircle2 className="size-4 text-emerald-500" /> : <span className="size-4 rounded-full border border-slate-300" />}
                    {b.fromName ? `${b.fromName} <${b.fromEmail}>` : b.fromEmail}
                    {b.source === "env" && <Badge>variables d&apos;env.</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {b.smtpHost}:{b.smtpPort} · {b.sentToday}/{b.dailyLimit} envoyés aujourd&apos;hui ·{" "}
                    {b.imapHost ? (
                      <>
                        <Inbox className="inline size-3" /> réponses lues {ago(b.lastSyncAt)}
                      </>
                    ) : (
                      "réponses non détectées (IMAP absent)"
                    )}
                  </div>
                  {b.lastError && <div className="mt-0.5 text-xs text-red-600">Dernière erreur : {b.lastError}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === `test-${b.id}`}
                    onClick={() =>
                      run(`test-${b.id}`, () => post(`/api/mailboxes/${b.id}/test`), (j) => `${b.fromEmail} — SMTP : ${j.smtp} · IMAP : ${j.imap}`)
                    }
                  >
                    Tester
                  </Button>
                  {b.source === "db" && (
                    <>
                      <Input
                        type="number"
                        min={1}
                        max={500}
                        defaultValue={b.dailyLimit}
                        className="h-8 w-20"
                        title="Limite quotidienne"
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v && v !== b.dailyLimit)
                            run(
                              `limit-${b.id}`,
                              () => fetch(`/api/mailboxes/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyLimit: v }) }),
                              () => `Limite de ${b.fromEmail} : ${v} / jour.`,
                            );
                        }}
                      />
                      <Toggle
                        checked={b.enabled}
                        label=""
                        onChange={(v) =>
                          run(
                            `toggle-${b.id}`,
                            () => fetch(`/api/mailboxes/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: v }) }),
                            () => `${b.fromEmail} ${v ? "activée" : "désactivée"}.`,
                          )
                        }
                      />
                      <button
                        className="text-slate-400 hover:text-red-600"
                        aria-label={`Supprimer ${b.fromEmail}`}
                        onClick={() =>
                          confirm(`Supprimer la boîte ${b.fromEmail} ?`) &&
                          run(`del-${b.id}`, () => fetch(`/api/mailboxes/${b.id}`, { method: "DELETE" }), () => `${b.fromEmail} supprimée.`)
                        }
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["google", "Google Workspace / Gmail"],
                  ["microsoft", "Microsoft 365"],
                  ["zoho", "Zoho Mail"],
                  ["ovh", "OVHcloud"],
                  ["other", "Autre"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setPreset(k);
                    const p = PRESETS[k];
                    setForm((f) => ({ ...f, smtpHost: p.smtpHost, smtpPort: p.smtpPort, smtpSecure: p.smtpSecure, imapHost: p.imapHost, imapPort: p.imapPort }));
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${preset === k ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-600">{PRESETS[preset].hint}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Adresse d&apos;envoi</Label>
                <Input type="email" value={form.fromEmail} onChange={(e) => set("fromEmail", e.target.value)} placeholder="camille@acme-studio.fr" />
              </div>
              <div>
                <Label>Nom affiché</Label>
                <Input value={form.fromName} onChange={(e) => set("fromName", e.target.value)} placeholder="Camille Martin" />
              </div>
              <div>
                <Label>Identifiant</Label>
                <Input value={form.smtpUser} onChange={(e) => set("smtpUser", e.target.value)} placeholder="souvent l'adresse email" />
              </div>
              <div>
                <Label hint="(stocké chiffré)">Mot de passe d&apos;application</Label>
                <Input type="password" value={form.smtpPass} onChange={(e) => set("smtpPass", e.target.value)} autoComplete="new-password" />
              </div>
              <div>
                <Label>Serveur SMTP</Label>
                <div className="flex gap-2">
                  <Input value={form.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} />
                  <Input type="number" className="w-24" value={form.smtpPort} onChange={(e) => set("smtpPort", Number(e.target.value))} />
                </div>
              </div>
              <div>
                <Label hint="(lecture des réponses)">Serveur IMAP</Label>
                <div className="flex gap-2">
                  <Input value={form.imapHost} onChange={(e) => set("imapHost", e.target.value)} placeholder="facultatif" />
                  <Input type="number" className="w-24" value={form.imapPort} onChange={(e) => set("imapPort", Number(e.target.value))} />
                </div>
              </div>
              <div>
                <Label>Limite quotidienne</Label>
                <Input type="number" min={1} max={500} value={form.dailyLimit} onChange={(e) => set("dailyLimit", Number(e.target.value))} />
              </div>
              <div className="flex items-end">
                <Toggle checked={form.smtpSecure} onChange={(v) => set("smtpSecure", v)} label="SMTP en TLS direct" hint="Port 465 : activé · port 587 : désactivé (STARTTLS)" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Annuler
              </Button>
              <Button
                loading={busy === "add"}
                disabled={!form.fromEmail || !form.smtpUser || !form.smtpPass || !form.smtpHost}
                onClick={async () => {
                  const ok = await run("add", () => post("/api/mailboxes", form), () => `${form.fromEmail} ajoutée et testée avec succès.`);
                  if (ok) {
                    setForm(EMPTY);
                    setAdding(false);
                  }
                }}
              >
                Vérifier et ajouter
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <Label>Envoyer un email de test</Label>
            <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="vous@exemple.com" />
          </div>
          <select
            id="test-mailbox"
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm shadow-sm"
            defaultValue={boxes[0]?.id}
            disabled={!boxes.length}
          >
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fromEmail}
              </option>
            ))}
          </select>
          <Button
            disabled={!boxes.length || !testTo}
            loading={busy === "test-send"}
            onClick={() =>
              run(
                "test-send",
                () => post("/api/settings/test-email", { to: testTo, mailboxId: (document.getElementById("test-mailbox") as HTMLSelectElement)?.value }),
                () => "✅ Email de test envoyé.",
              )
            }
            icon={<Send className="size-4" />}
          >
            Tester
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Adresse postale en pied d&apos;email :{" "}
          {senderAddress || <span className="text-amber-700">à renseigner (variable SENDER_ADDRESS, obligatoire en prospection)</span>}
        </p>
      </div>
    </Card>
  );
}
