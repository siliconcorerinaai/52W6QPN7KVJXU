"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Mail, MessageSquareReply, RefreshCw, Send, UserX, X } from "lucide-react";
import { ContactStatusBadge, EmailBadge, ScoreBadge, signalIcon } from "./badges";
import { Badge, Button, Input, Linkedin, Textarea } from "./ui";
import type { Company, Contact, Message } from "@/lib/db/schema";

type Detail = { contact: Contact; company: Company; messages: Message[] };

const EMAIL_SOURCE: Record<string, string> = {
  published: "publiée sur le site",
  pattern: "format déduit des emails de l'entreprise",
  "pattern-guess": "format le plus courant",
  hunter: "Hunter.io",
  smtp: "confirmée par SMTP",
  verified: "confirmée par un service de vérification",
  provider: "base de données B2B",
  manual: "saisie manuelle",
};

const MSG_STATUS: Record<string, string> = {
  draft: "Brouillon",
  approved: "Approuvé",
  scheduled: "Planifié",
  sent: "Envoyé",
  failed: "Échec",
  cancelled: "Annulé",
};

function MessageEditor({ m, onSaved }: { m: Message; onSaved: () => void }) {
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const [saving, setSaving] = useState(false);
  const dirty = subject !== m.subject || body !== m.body;
  const locked = m.status === "sent";

  useEffect(() => {
    setSubject(m.subject);
    setBody(m.body);
  }, [m.subject, m.body]);

  async function save() {
    setSaving(true);
    await fetch(`/api/messages/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body }) });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs">
        <span className="font-semibold text-slate-700">
          Email {m.step}
          {m.step > 1 && <span className="font-normal text-slate-400"> · J+{m.delayDays} après le précédent</span>}
        </span>
        <span className="flex items-center gap-2">
          {m.scheduledAt && m.status !== "sent" && (
            <span className="text-slate-400">{new Date(m.scheduledAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
          )}
          {m.sentAt && <span className="text-slate-400">{new Date(m.sentAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>}
          <Badge tone={m.status === "sent" ? "violet" : m.status === "failed" ? "red" : m.status === "draft" ? "amber" : "blue"}>{MSG_STATUS[m.status] ?? m.status}</Badge>
        </span>
      </div>
      <div className="space-y-2 p-3">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={locked} className="font-medium" />
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={locked} rows={Math.min(14, Math.max(5, body.split("\n").length + 1))} className="leading-relaxed" />
        {m.error && <p className="text-xs text-red-600">{m.error}</p>}
        {dirty && !locked && (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} loading={saving} icon={<Check className="size-3.5" />}>
              Enregistrer
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Panneau latéral : tout ce qu'il faut savoir sur un lead + sa séquence d'emails. */
export function LeadDrawer({ contactId, onClose, onChanged }: { contactId: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/contacts/${contactId}`);
    if (res.ok) setData(await res.json());
  }, [contactId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function act(name: string, fn: () => Promise<Response>) {
    setBusy(name);
    await fn();
    await load();
    onChanged();
    setBusy(null);
  }

  const patch = (body: object) => () => fetch(`/api/contacts/${contactId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const c = data?.contact;
  const co = data?.company;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="slide-in relative flex h-full w-full max-w-2xl flex-col bg-slate-50 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          {c ? (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-lg font-semibold">{c.fullName}</h2>
                <ContactStatusBadge status={c.status} />
              </div>
              <p className="text-sm text-slate-500">
                {c.title ?? "—"} · {co?.name}
              </p>
            </div>
          ) : (
            <div className="h-10" />
          )}
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fermer">
            <X className="size-5" />
          </button>
        </div>

        {!c || !co ? (
          <div className="p-8 text-center text-sm text-slate-400">Chargement…</div>
        ) : (
          <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
            {/* Contact */}
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Mail className="size-4 text-slate-400" />
                {editEmail !== null ? (
                  <>
                    <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="h-8 max-w-xs" />
                    <Button size="sm" loading={busy === "email"} onClick={() => act("email", patch({ email: editEmail })).then(() => setEditEmail(null))}>
                      Vérifier
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditEmail(null)}>
                      Annuler
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-slate-900">{c.email ?? "Aucun email"}</span>
                    <EmailBadge status={c.emailStatus} confidence={c.emailConfidence} />
                    {c.email && (
                      <button
                        className="text-slate-400 hover:text-slate-700"
                        title="Copier"
                        onClick={() => {
                          navigator.clipboard?.writeText(c.email!);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                      >
                        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                      </button>
                    )}
                    <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setEditEmail(c.email ?? "")}>
                      Modifier
                    </button>
                  </>
                )}
              </div>
              {c.notes && (
                <p className="mt-1.5 text-xs text-slate-500">
                  {c.notes}
                  {c.emailSource ? ` · source : ${EMAIL_SOURCE[c.emailSource] ?? c.emailSource}` : ""}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {c.linkedinUrl && (
                  <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                    <Linkedin className="size-4" /> Profil LinkedIn
                  </a>
                )}
                {c.relevanceReason && <span className="text-slate-600">🎯 {c.relevanceReason}</span>}
              </div>
            </section>

            {/* Entreprise */}
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{co.name}</h3>
                    <ScoreBadge score={co.score} />
                  </div>
                  <p className="text-xs text-slate-500">
                    {[co.industry, co.employeeRange && `${co.employeeRange} salariés`, [co.location, co.country].filter((x) => x && x !== "inconnu").join(", ")]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {co.website && (
                  <a href={co.website} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-brand-600 hover:underline">
                    {co.domain} <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              {co.description && <p className="mt-2 text-sm text-slate-700">{co.description}</p>}
              {co.scoreReasons.length > 0 && (
                <ul className="mt-3 list-disc space-y-0.5 pl-4 text-sm text-slate-600">
                  {co.scoreReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {co.signals.length > 0 && (
                <div className="mt-3 space-y-1 rounded-lg bg-amber-50/60 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Signaux d&apos;achat</div>
                  {co.signals.map((s) => (
                    <div key={s.text} className="text-slate-700">
                      {signalIcon(s.type)} {s.text}
                      {s.date && <span className="text-xs text-slate-400"> · {s.date}</span>}
                      {s.source && (
                        <a href={s.source} target="_blank" rel="noreferrer" className="ml-1 text-xs text-brand-600 hover:underline">
                          source
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {co.techStack.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {co.techStack.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              )}
            </section>

            {/* Séquence */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Séquence personnalisée</h3>
                <div className="flex flex-wrap gap-2">
                  {c.email && !["sent", "replied", "unsubscribed", "bounced"].includes(c.status) && (
                    <Button size="sm" variant="secondary" loading={busy === "rewrite"} onClick={() => act("rewrite", patch({ rewrite: true }))} icon={<RefreshCw className="size-3.5" />}>
                      {data.messages.length ? "Régénérer" : "Rédiger"}
                    </Button>
                  )}
                  {c.status === "drafted" && (
                    <Button
                      size="sm"
                      variant="success"
                      loading={busy === "approve"}
                      onClick={() =>
                        act("approve", () =>
                          fetch(`/api/campaigns/${c.campaignId}/approve`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ contactIds: [c.id] }),
                          }),
                        )
                      }
                      icon={<Send className="size-3.5" />}
                    >
                      Approuver l&apos;envoi
                    </Button>
                  )}
                </div>
              </div>
              {data.messages.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  {c.email ? "Aucune séquence rédigée pour l'instant." : "Un email est nécessaire pour rédiger une séquence."}
                </p>
              ) : (
                data.messages.map((m) => <MessageEditor key={m.id} m={m} onSaved={load} />)
              )}
            </section>

            <section className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
              {c.status !== "replied" && (
                <Button size="sm" variant="secondary" loading={busy === "replied"} onClick={() => act("replied", patch({ status: "replied" }))} icon={<MessageSquareReply className="size-3.5" />}>
                  A répondu (stoppe les relances)
                </Button>
              )}
              {c.status !== "unsubscribed" && (
                <Button size="sm" variant="ghost" loading={busy === "unsub"} onClick={() => act("unsub", patch({ status: "unsubscribed" }))} icon={<UserX className="size-3.5" />}>
                  Ne plus contacter
                </Button>
              )}
              {["approved", "replied", "unsubscribed"].includes(c.status) && (
                <Button size="sm" variant="ghost" loading={busy === "draft"} onClick={() => act("draft", patch({ status: "drafted" }))}>
                  Remettre en brouillon
                </Button>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
