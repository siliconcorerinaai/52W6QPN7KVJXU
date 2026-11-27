"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Check, Copy, Download, ExternalLink, MessageCircle, Megaphone, RefreshCw, Search, Sparkles } from "lucide-react";
import { Badge, Button, Input, Textarea, type Tone } from "@/components/ui";
import { FACEBOOK_DAILY_ADVICE } from "@/lib/social";
import type { FacebookRow } from "@/lib/pipeline/social";
import type { AdCopy } from "@/lib/ai/schemas";

type Board = {
  rows: (Omit<FacebookRow, "social"> & { social: (Omit<NonNullable<FacebookRow["social"]>, "sentAt"> & { sentAt: string | null }) | null })[];
  stats: { companies: number; withPage: number; toSearch: number; toPrepare: number; todo: number; sent: number; replied: number; sentToday: number };
  ads: { adCopy: AdCopy | null; campaign: number; all: number; min: number };
};

const FILTERS = [
  ["todo", "À envoyer"],
  ["sent", "Envoyés"],
  ["replied", "Réponses"],
  ["nopage", "Sans page"],
  ["all", "Toutes"],
] as const;
type Filter = (typeof FILTERS)[number][0];

const STATUS: Record<string, { label: string; tone: Tone }> = {
  todo: { label: "À envoyer", tone: "blue" },
  sent: { label: "Envoyé", tone: "violet" },
  replied: { label: "A répondu", tone: "green" },
  skipped: { label: "Ignoré", tone: "slate" },
};

const DOWNLOAD =
  "inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50";

async function post(url: string, body: object, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Erreur");
  return json;
}

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <li className="flex items-start justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
      <span className="text-slate-700">{text}</span>
      <button
        className="shrink-0 text-slate-400 hover:text-slate-700"
        title="Copier"
        onClick={() => navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
      >
        {done ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
    </li>
  );
}

function Row({ r, campaignId, onChanged }: { r: Board["rows"][number]; campaignId: string; onChanged: () => void }) {
  const [message, setMessage] = useState(r.social?.message ?? "");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setMessage(r.social?.message ?? ""), [r.social?.message]);

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  const setStatus = (status: string) => act(status, () => post(`/api/social/${r.social!.id}`, { status }, "PATCH"));

  async function copyAndOpen() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setError("Copie impossible : sélectionnez le texte et copiez-le.");
    }
    window.open(r.messengerUrl ?? r.facebookUrl ?? "#", "_blank", "noopener,noreferrer");
  }

  const status = r.social?.status;
  return (
    <li className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">{r.name}</span>
            {status && <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
            <span>{r.domain}</span>
            {r.location && <span>{r.location}</span>}
            {r.facebookUrl && (
              <a href={r.facebookUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-600 hover:underline">
                Page Facebook <ExternalLink className="size-3" />
              </a>
            )}
            {r.instagramUrl && (
              <a href={r.instagramUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-600 hover:underline">
                Instagram <ExternalLink className="size-3" />
              </a>
            )}
            {r.social?.sentAt && <span>Envoyé le {new Date(r.social.sentAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>}
          </div>
        </div>
        {r.sample && (
          // eslint-disable-next-line @next/next/no-img-element -- image servie telle quelle
          <img src={`/v/${r.sample.id}/image`} alt="" className="size-14 rounded-lg object-cover ring-1 ring-slate-200" title="Visuel offert, cité dans le message" />
        )}
      </div>

      {!r.facebookUrl ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">{r.searched ? "Aucune page Facebook trouvée sur son site." : "Page Facebook pas encore recherchée."} Vous la connaissez ? Collez son lien :</p>
          <div className="flex gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.facebook.com/nomdelapage" className="text-sm" />
            <Button
              size="sm"
              variant="secondary"
              disabled={url.trim().length < 10}
              loading={busy === "url"}
              onClick={() => act("url", () => post(`/api/campaigns/${campaignId}/facebook`, { action: "setUrl", companyId: r.companyId, url }))}
            >
              Enregistrer
            </Button>
          </div>
        </div>
      ) : !r.social ? (
        <p className="text-sm text-slate-500">✍️ Message en préparation…</p>
      ) : (
        <>
          <Textarea
            rows={Math.min(14, Math.max(5, message.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 75)), 1)))}
            value={message}
            disabled={status !== "todo"}
            onChange={(e) => setMessage(e.target.value)}
            onBlur={() => message !== r.social!.message && act("save", () => post(`/api/social/${r.social!.id}`, { message }, "PATCH"))}
            className="text-sm leading-relaxed"
          />
          <div className="flex flex-wrap items-center gap-2">
            {status === "todo" && (
              <>
                <Button size="sm" onClick={copyAndOpen} icon={<MessageCircle className="size-3.5" />}>
                  Copier et ouvrir Messenger
                </Button>
                <Button size="sm" variant="success" loading={busy === "sent"} onClick={() => setStatus("sent")} icon={<Check className="size-3.5" />}>
                  C&apos;est envoyé
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === "rewrite"}
                  onClick={() => act("rewrite", () => post(`/api/campaigns/${campaignId}/facebook`, { action: "rewrite", companyId: r.companyId }))}
                  icon={<RefreshCw className="size-3.5" />}
                >
                  Réécrire
                </Button>
                <Button size="sm" variant="ghost" loading={busy === "skipped"} onClick={() => setStatus("skipped")}>
                  Ignorer
                </Button>
              </>
            )}
            {status === "sent" && (
              <>
                <Button size="sm" variant="success" loading={busy === "replied"} onClick={() => setStatus("replied")} icon={<MessageCircle className="size-3.5" />}>
                  A répondu
                </Button>
                <Button size="sm" variant="ghost" loading={busy === "todo"} onClick={() => setStatus("todo")}>
                  Pas encore envoyé
                </Button>
              </>
            )}
            {status === "skipped" && (
              <Button size="sm" variant="ghost" loading={busy === "todo"} onClick={() => setStatus("todo")}>
                Remettre à envoyer
              </Button>
            )}
            {copied && status === "todo" && (
              <span className="text-xs text-emerald-700">Copié ! Collez-le dans la conversation Messenger, envoyez, puis cliquez « C&apos;est envoyé ».</span>
            )}
          </div>
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </li>
  );
}

function AdsPanel({ campaignId, ads, onChanged }: { campaignId: string; ads: Board["ads"]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const small = ads.all < ads.min;
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-slate-900">
          <Megaphone className="size-4 text-brand-600" /> Publicité ciblée sur Facebook et Instagram
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Vos prospects voient votre offre dans leur fil pendant que vous leur écrivez : ils vous reconnaissent quand ils lisent votre message.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium text-slate-800">1. L&apos;audience à importer chez Meta</div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/campaigns/${campaignId}/facebook/audience`} className={DOWNLOAD}>
            <Download className="size-3.5" /> Cette campagne ({ads.campaign})
          </a>
          <a href={`/api/campaigns/${campaignId}/facebook/audience?scope=all`} className={DOWNLOAD}>
            <Download className="size-3.5" /> Toutes mes campagnes ({ads.all})
          </a>
        </div>
        {small && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            Meta ne diffuse une audience personnalisée qu&apos;à partir d&apos;environ {ads.min} personnes reconnues. Vous en avez {ads.all} : trouvez plus de leads
            (bouton « Trouver plus ») ou lancez d&apos;autres campagnes, puis téléchargez « Toutes mes campagnes ».
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-800">2. Les textes de l&apos;annonce</span>
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            icon={<Sparkles className="size-3.5" />}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await post(`/api/campaigns/${campaignId}/facebook`, { action: "adcopy" });
                onChanged();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {ads.adCopy ? "Rédiger d'autres textes" : "Rédiger les textes"}
          </Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {ads.adCopy && (
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div className="md:col-span-2">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Texte principal</div>
              <ul className="space-y-1.5">{ads.adCopy.primaryTexts.map((t) => <CopyLine key={t} text={t} />)}</ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Titre</div>
              <ul className="space-y-1.5">{ads.adCopy.headlines.map((t) => <CopyLine key={t} text={t} />)}</ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Description</div>
              <ul className="space-y-1.5">{ads.adCopy.descriptions.map((t) => <CopyLine key={t} text={t} />)}</ul>
              <p className="mt-2 text-xs text-slate-500">Bouton conseillé : {ads.adCopy.callToAction.replace(/_/g, " ").toLowerCase()}</p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1 text-sm">
        <div className="font-medium text-slate-800">3. La publicité, en 10 minutes</div>
        <ol className="list-decimal space-y-1 pl-5 text-slate-600">
          <li>
            Ouvrez le{" "}
            <a href="https://adsmanager.facebook.com/" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
              Gestionnaire de publicités Meta
            </a>{" "}
            → Audiences → Créer une audience → Audience personnalisée → Liste de clients.
          </li>
          <li>Importez le fichier téléchargé : Meta reconnaît les colonnes (email, prénom, nom, ville, pays) et les chiffre avant l&apos;envoi.</li>
          <li>Créez une campagne « Trafic » ou « Interactions → Messages », ciblez cette audience, environ 5 $ par jour pendant 7 jours.</li>
          <li>Image : l&apos;un de vos visuels offerts ; textes : ceux ci-dessus. Placements : fil et Stories, Facebook et Instagram.</li>
        </ol>
        <p className="pt-1 text-xs text-slate-500">
          Les prospects désinscrits ou exclus ne sont pas dans le fichier. En l&apos;important, vous acceptez les conditions des audiences personnalisées de Meta.
        </p>
      </div>
    </section>
  );
}

/** Onglet Facebook d'une campagne : messages Messenger préparés à envoyer soi-même, et publicité ciblée. */
export function FacebookTab({ campaignId }: { campaignId: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState<Filter>("todo");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/facebook`);
    if (res.ok) setBoard(await res.json());
  }, [campaignId]);

  // Recherches et rédactions en cours : on rafraîchit plus souvent.
  const pending = !!board && board.rows.some((r) => (r.facebookUrl && !r.social) || (preparing && !r.facebookUrl && !r.searched));
  useEffect(() => {
    load();
    const t = setInterval(load, pending ? 4000 : 20000);
    return () => clearInterval(t);
  }, [load, pending]);

  if (!board) return <div className="p-8 text-center text-sm text-slate-400">Chargement…</div>;
  const { stats } = board;
  const rows = board.rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "nopage") return !r.facebookUrl;
    if (filter === "todo") return !!r.facebookUrl && (!r.social || r.social.status === "todo");
    return r.social?.status === filter;
  });
  const overLimit = stats.sentToday >= FACEBOOK_DAILY_ADVICE;

  return (
    <div className="space-y-5 p-5">
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h3 className="font-semibold text-slate-900">Assistant Facebook</h3>
            <p className="text-sm text-slate-600">
              Pour chaque entreprise, sa page Facebook et un message personnalisé qui cite son visuel offert. Vous l&apos;envoyez vous-même en deux clics :
              Facebook interdit les envois automatiques et bloque les comptes qui les utilisent.
            </p>
          </div>
          {(stats.toSearch > 0 || stats.toPrepare > 0) && (
            <Button
              loading={busy}
              icon={<Search className="size-4" />}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await post(`/api/campaigns/${campaignId}/facebook`, { action: "prepare" });
                  setNotice(`Recherche de ${r.searching} page(s) et rédaction de ${r.writing} message(s) lancées.`);
                  setPreparing(true);
                  await load();
                } catch (e) {
                  setNotice(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Trouver les pages et préparer les messages
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="slate">
            Pages trouvées : {stats.withPage}/{stats.companies}
          </Badge>
          <Badge tone="blue">À envoyer : {stats.todo}</Badge>
          <Badge tone="violet">Envoyés : {stats.sent + stats.replied}</Badge>
          <Badge tone="green">Réponses : {stats.replied}</Badge>
          <Badge tone={overLimit ? "amber" : "slate"} title="Au-delà, Facebook peut restreindre votre compte">
            Aujourd&apos;hui : {stats.sentToday}/{FACEBOOK_DAILY_ADVICE} conseillés
          </Badge>
        </div>
        {overLimit && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            Vous avez envoyé {stats.sentToday} messages en 24 h. Faites une pause jusqu&apos;à demain pour ne pas être restreint par Facebook.
          </p>
        )}
        {notice && <p className="text-sm text-brand-700">{notice}</p>}
      </section>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", filter === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          {stats.companies === 0
            ? "Aucune entreprise qualifiée pour l'instant."
            : filter === "todo" && stats.toSearch + stats.toPrepare > 0
              ? "Cliquez sur « Trouver les pages et préparer les messages »."
              : "Rien ici pour l'instant."}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <Row key={r.companyId} r={r} campaignId={campaignId} onChanged={load} />
          ))}
        </ul>
      )}

      <AdsPanel campaignId={campaignId} ads={board.ads} onChanged={load} />
    </div>
  );
}
