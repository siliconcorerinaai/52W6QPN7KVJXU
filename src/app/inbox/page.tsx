"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, Check, Inbox, RefreshCw, RotateCcw, Send, Sparkles } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Label, Textarea, type Tone } from "@/components/ui";
import type { ReplyCategory } from "@/lib/db/schema";

type Item = {
  id: string;
  category: ReplyCategory | null;
  status: "new" | "handled" | "answered";
  summary: string | null;
  subject: string;
  snippet: string;
  receivedAt: string;
  contactName: string;
  contactTitle: string | null;
  companyName: string;
  campaignName: string;
};

type Detail = {
  reply: {
    id: string;
    category: ReplyCategory | null;
    status: "new" | "handled" | "answered";
    summary: string | null;
    draftSubject: string | null;
    draftBody: string | null;
  };
  contact: { id: string; fullName: string; title: string | null; email: string | null; status: string };
  company: { name: string; domain: string };
  campaign: { id: string; name: string };
  thread: { id: string; kind: "sequence" | "reply"; from: "us" | "prospect"; subject: string; body: string; at: string }[];
};

const FILTERS = [
  ["todo", "À traiter"],
  ["interested", "Intéressés"],
  ["question", "Questions"],
  ["not_now", "Pas maintenant"],
  ["all", "Toutes"],
] as const;

const CATEGORY: Record<ReplyCategory, { label: string; tone: Tone }> = {
  interested: { label: "Intéressé", tone: "green" },
  question: { label: "Question", tone: "blue" },
  not_now: { label: "Pas maintenant", tone: "amber" },
  not_interested: { label: "Pas intéressé", tone: "slate" },
  unsubscribe: { label: "Désinscription", tone: "red" },
  auto: { label: "Réponse automatique", tone: "slate" },
  other: { label: "Autre", tone: "violet" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function CategoryBadge({ category }: { category: ReplyCategory | null }) {
  if (!category) return <Badge tone="slate">Analyse…</Badge>;
  return <Badge tone={CATEGORY[category].tone}>{CATEGORY[category].label}</Badge>;
}

function ReplyView({ id, onChanged, onBack }: { id: string; onChanged: () => void; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((next: Detail) => {
    setD(next);
    setSubject(next.reply.draftSubject ?? "");
    setBody(next.reply.draftBody ?? "");
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const res = await fetch(`/api/replies/${id}`);
      if (!res.ok || stop) return;
      const next = (await res.json()) as Detail;
      apply(next);
      // Analyse encore en cours : on revient voir quelques secondes plus tard.
      if (!next.reply.category) setTimeout(() => !stop && load(), 4000);
    };
    setD(null);
    setError(null);
    load();
    return () => {
      stop = true;
    };
  }, [id, apply]);

  async function act(name: string, url: string, init: RequestInit) {
    setBusy(name);
    setError(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      if (json.reply) apply(json as Detail);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!d) return <div className="p-8 text-center text-sm text-slate-400">Chargement…</div>;
  const answered = d.reply.status === "answered";

  return (
    <div className="space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 lg:hidden">
            <ArrowLeft className="size-4" /> Toutes les réponses
          </button>
          <h2 className="truncate text-lg font-semibold">{d.contact.fullName}</h2>
          <p className="text-sm text-slate-500">
            {d.contact.title ?? "—"} · {d.company.name} ·{" "}
            <Link href={`/campaigns/${d.campaign.id}`} className="text-brand-600 hover:underline">
              {d.campaign.name}
            </Link>
          </p>
        </div>
        <CategoryBadge category={d.reply.category} />
      </div>

      {d.reply.summary && (
        <div className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          <Sparkles className="mt-0.5 size-4 shrink-0" /> {d.reply.summary}
        </div>
      )}

      <ol className="space-y-3">
        {d.thread.map((t) => (
          <li
            key={t.id}
            className={clsx(
              "rounded-xl border p-4 text-sm",
              t.from === "prospect" ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white",
            )}
          >
            <div className="mb-1 flex items-center justify-between gap-3 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{t.from === "prospect" ? d.contact.fullName : "Vous"}</span>
              <span>{when(t.at)}</span>
            </div>
            <div className="mb-1 font-medium text-slate-900">{t.subject}</div>
            <p className="whitespace-pre-wrap text-slate-700">{t.body || "(message sans texte)"}</p>
          </li>
        ))}
      </ol>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {answered ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✅ Vous avez répondu à ce message.</p>
      ) : d.reply.draftBody !== null || d.reply.category ? (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">Votre réponse</h3>
            <span className="text-xs text-slate-500">préparée par l&apos;IA, modifiable</span>
          </div>
          <div>
            <Label>Objet</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <Textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Votre réponse…" />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => act("send", `/api/replies/${id}/send`, { method: "POST", body: JSON.stringify({ subject, body }) })}
              loading={busy === "send"}
              disabled={subject.trim().length < 1 || body.trim().length < 2}
              icon={<Send className="size-4" />}
            >
              Envoyer
            </Button>
            <Button variant="secondary" onClick={() => act("draft", `/api/replies/${id}/draft`, { method: "POST" })} loading={busy === "draft"} icon={<RefreshCw className="size-4" />}>
              Nouveau brouillon
            </Button>
            {d.reply.status === "new" ? (
              <Button variant="ghost" onClick={() => act("handled", `/api/replies/${id}`, { method: "PATCH", body: JSON.stringify({ status: "handled" }) })} loading={busy === "handled"} icon={<Check className="size-4" />}>
                Marquer comme traitée
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => act("new", `/api/replies/${id}`, { method: "PATCH", body: JSON.stringify({ status: "new" }) })} loading={busy === "new"}>
                Remettre à traiter
              </Button>
            )}
          </div>
        </section>
      ) : null}

      {d.contact.status === "replied" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <span>Ce n&apos;était pas une vraie réponse ? Les relances de ce prospect sont arrêtées.</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act("resume", `/api/contacts/${d.contact.id}`, { method: "PATCH", body: JSON.stringify({ resume: true }) }).then(() =>
              fetch(`/api/replies/${id}`).then((r) => r.json()).then(apply),
            )}
            loading={busy === "resume"}
            icon={<RotateCcw className="size-3.5" />}
          >
            Reprendre les relances
          </Button>
        </div>
      )}
    </div>
  );
}

function InboxPage() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("r");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("todo");
  const [items, setItems] = useState<Item[] | null>(null);
  const [toHandle, setToHandle] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch(`/api/replies?filter=${filter}`);
    if (!res.ok) return;
    const json = await res.json();
    setItems(json.replies);
    setToHandle(json.toHandle);
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const open = (id: string | null) => router.replace(id ? `/inbox?r=${id}` : "/inbox", { scroll: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Réponses</h1>
        <p className="text-sm text-slate-500">
          Les réponses de vos prospects, classées par l&apos;IA, avec une réponse prête à envoyer.{" "}
          {toHandle > 0 && <strong className="text-slate-700">{toHandle} à traiter.</strong>}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={clsx(
              "rounded-full px-3 py-1 text-sm font-medium",
              filter === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className={clsx("overflow-hidden", selected && "hidden lg:block")}>
          {items === null ? (
            <div className="p-8 text-center text-sm text-slate-400">Chargement…</div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-5" />}
              title={filter === "todo" ? "Rien à traiter" : "Aucune réponse"}
              text="Les réponses de vos prospects apparaissent ici quelques minutes après leur arrivée dans votre boîte."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    onClick={() => open(it.id)}
                    className={clsx("block w-full px-4 py-3 text-left hover:bg-slate-50", selected === it.id && "bg-brand-50/60")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={clsx("truncate text-sm", it.status === "new" ? "font-semibold text-slate-900" : "text-slate-700")}>
                        {it.contactName} · {it.companyName}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">{when(it.receivedAt)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <CategoryBadge category={it.category} />
                      <span className="truncate text-xs text-slate-500">{it.summary ?? it.snippet}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className={clsx(!selected && "hidden lg:block")}>
          {selected ? (
            <ReplyView
              id={selected}
              onChanged={() => {
                load();
                window.dispatchEvent(new Event("replies:changed"));
              }}
              onBack={() => open(null)}
            />
          ) : (
            <EmptyState icon={<Inbox className="size-5" />} title="Choisissez une réponse" text="La conversation et la réponse proposée s'affichent ici." />
          )}
        </Card>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <InboxPage />
    </Suspense>
  );
}
