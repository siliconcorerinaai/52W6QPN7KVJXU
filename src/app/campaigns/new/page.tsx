"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bot, Briefcase, Building2, Link2, ListChecks, Rocket, Settings2, Sparkles, Target, Wand2, X } from "lucide-react";
import clsx from "clsx";
import { Button, Card, CardHeader, Input, Label, Textarea, Toggle } from "@/components/ui";
import { ChipsEditor } from "@/components/ChipsEditor";
import { EXAMPLES } from "@/components/HeroSearch";
import { COUNTRIES } from "@/lib/countries";
import type { CampaignOffer, CampaignPlan, CampaignSettings, ImportedCompany, LinkKind } from "@/lib/types";

type Plan = CampaignPlan & { campaignName: string; feasible?: boolean; feasibilityIssue?: string | null };

type LinkResult = {
  plan: Plan;
  prompt: string;
  offer: Partial<CampaignOffer>;
  companies: ImportedCompany[];
  seeds: string[];
  title: string;
  outsideCountry: number;
};

/** Ce que le lien a apporté : affiché sur le plan et ajouté aux réglages au lancement. */
type LinkInfo = {
  kind: LinkKind;
  title: string;
  country: string;
  companies: ImportedCompany[];
  seeds: string[];
  outsideCountry: number;
  importOnly: boolean;
};

const LINK_OPTIONS: { kind: LinkKind; icon: typeof Building2; title: string; text: string; placeholder: string }[] = [
  {
    kind: "own",
    icon: Building2,
    title: "Le site de mon entreprise",
    text: "L'agent comprend votre offre et trouve vos clients idéaux.",
    placeholder: "https://www.votre-entreprise.com",
  },
  {
    kind: "list",
    icon: ListChecks,
    title: "Une liste d'entreprises",
    text: "Annuaire, exposants d'un salon, classement… L'agent les prospecte.",
    placeholder: "https://www.salon-exemple.com/exposants",
  },
  {
    kind: "target",
    icon: Target,
    title: "Une entreprise cible",
    text: "L'agent la prospecte et trouve des entreprises similaires.",
    placeholder: "https://www.client-modele.com",
  },
];

const LINK_KEY = "ciblora.link";

const DEFAULT_OFFER: CampaignOffer = {
  senderCompany: "",
  senderName: "",
  product: "",
  valueProposition: "",
  callToAction: "un échange de 15 minutes",
  bookingUrl: "",
  tone: "professionnel et chaleureux",
  language: "auto",
};

const DEFAULT_SETTINGS: CampaignSettings = {
  targetCompanies: 25,
  contactsPerCompany: 2,
  minScore: 60,
  autoWrite: true,
  deepResearch: true,
  sequenceSteps: 3,
  followUpDays: 3,
  seedDomains: [],
  webhookUrl: "",
};

const OFFER_KEY = "prospecta.offer";

function NewCampaign() {
  const router = useRouter();
  const params = useSearchParams();
  const [prompt, setPrompt] = useState(params.get("prompt") ?? "");
  const [offer, setOffer] = useState<CampaignOffer>(DEFAULT_OFFER);
  const [settings, setSettings] = useState<CampaignSettings>(DEFAULT_SETTINGS);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState<"plan" | "launch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mode, setMode] = useState<"describe" | "link">(params.get("mode") === "link" ? "link" : "describe");
  const [link, setLink] = useState<{ url: string; kind: LinkKind; country: string }>({ url: "", kind: "own", country: "" });
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(OFFER_KEY);
      if (saved) setOffer({ ...DEFAULT_OFFER, ...JSON.parse(saved) });
      const savedLink = localStorage.getItem(LINK_KEY);
      if (savedLink) setLink((l) => ({ ...l, country: (JSON.parse(savedLink) as { country?: string }).country ?? "" }));
    } catch {
      /* stockage indisponible */
    }
  }, []);

  function saveOffer(o: CampaignOffer) {
    try {
      localStorage.setItem(OFFER_KEY, JSON.stringify(o));
    } catch {
      /* stockage indisponible */
    }
  }

  const setO = (k: keyof CampaignOffer, v: string) => setOffer((o) => ({ ...o, [k]: v }));
  const setS = <K extends keyof CampaignSettings>(k: K, v: CampaignSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const setP = <K extends keyof Plan>(k: K, v: Plan[K]) => setPlan((p) => (p ? { ...p, [k]: v } : p));

  async function analyze() {
    setError(null);
    setLoading("plan");
    try {
      saveOffer(offer);
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, offer }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      setLinkInfo(null);
      setPlan(json.plan);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  async function analyzeLink() {
    setError(null);
    setLoading("plan");
    try {
      saveOffer(offer);
      try {
        localStorage.setItem(LINK_KEY, JSON.stringify({ country: link.country }));
      } catch {
        /* stockage indisponible */
      }
      const res = await fetch("/api/plan/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link.url, kind: link.kind, country: link.country, offer }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      const r = json as LinkResult;
      setPrompt(r.prompt);
      if (link.kind === "own") setOffer((o) => ({ ...o, ...r.offer }));
      setLinkInfo({
        kind: link.kind,
        title: r.title,
        country: link.country.trim(),
        companies: r.companies,
        seeds: r.seeds,
        outsideCountry: r.outsideCountry,
        importOnly: link.kind === "list",
      });
      setPlan(r.plan);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  /** Réglages envoyés au lancement : ceux du formulaire, complétés par ce que le lien a apporté. */
  function finalSettings(): CampaignSettings {
    if (!linkInfo) return settings;
    const n = linkInfo.companies.length;
    const fromList = linkInfo.kind === "list";
    return {
      ...settings,
      seedDomains: [...new Set([...settings.seedDomains, ...linkInfo.seeds])],
      importedCompanies: linkInfo.companies,
      importCursor: 0,
      importOnly: fromList && linkInfo.importOnly,
      targetCompanies: fromList ? Math.min(1000, Math.max(1, linkInfo.importOnly ? n : Math.max(n, settings.targetCompanies))) : settings.targetCompanies,
    };
  }

  async function launch() {
    if (!plan) return;
    setError(null);
    setLoading("launch");
    try {
      const { campaignName, feasible, feasibilityIssue, ...planBody } = plan;
      saveOffer(offer);
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: campaignName, prompt, plan: planBody, offer, settings: finalSettings() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      router.push(`/campaigns/${json.campaign.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{plan ? "Votre plan de prospection" : "Nouvelle recherche"}</h1>
        <p className="text-sm text-slate-500">
          {plan
            ? "Ajustez le ciblage proposé par l'IA, puis lancez l'agent."
            : mode === "link"
              ? "Collez un lien et choisissez le pays : l'agent prépare toute la prospection."
              : "Une phrase suffit. L'IA en déduit un plan de ciblage complet que vous pourrez ajuster."}
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!plan ? (
        <>
          <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm">
            {(
              [
                ["describe", "Décrire ma cible", Sparkles],
                ["link", "À partir d'un lien", Link2],
              ] as const
            ).map(([m, label, Icon]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-medium transition-colors",
                  mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>

          {mode === "link" ? (
            <Card>
              <CardHeader title="À partir d'un lien" subtitle="L'agent lit la page et prépare la prospection dans le pays choisi." icon={<Link2 className="size-4" />} />
              <div className="space-y-4 p-5">
                <div>
                  <Label>Ce lien est…</Label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {LINK_OPTIONS.map(({ kind, icon: Icon, title, text }) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => setLink((l) => ({ ...l, kind }))}
                        className={clsx(
                          "rounded-xl border p-3 text-left transition-colors",
                          link.kind === kind ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300",
                        )}
                      >
                        <Icon className="size-4 text-brand-600" />
                        <div className="mt-1.5 text-sm font-medium text-slate-900">{title}</div>
                        <div className="text-xs text-slate-500">{text}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label>Lien</Label>
                    <Input
                      type="url"
                      inputMode="url"
                      value={link.url}
                      onChange={(e) => setLink((l) => ({ ...l, url: e.target.value }))}
                      placeholder={LINK_OPTIONS.find((o) => o.kind === link.kind)?.placeholder}
                    />
                  </div>
                  <div>
                    <Label>Pays</Label>
                    <Input
                      list="ciblora-countries"
                      value={link.country}
                      onChange={(e) => setLink((l) => ({ ...l, country: e.target.value }))}
                      placeholder="Choisir ou écrire un pays"
                    />
                    <datalist id="ciblora-countries">
                      {COUNTRIES.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
          <Card>
            <CardHeader title="Votre client idéal" subtitle="Secteur, zone, taille, situation… soyez aussi précis que possible." icon={<Sparkles className="size-4" />} />
            <div className="space-y-3 p-5">
              <Textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex. : Fabricants de cosmétiques bio en France qui vendent en ligne et recrutent en marketing"
                className="text-base"
              />
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => setPrompt(ex)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </Card>
          )}

          <Card>
            <CardHeader
              title="Votre offre"
              subtitle={
                mode === "link" && link.kind === "own"
                  ? "Déduite de votre site : vous pourrez la vérifier. Indiquez au moins le signataire."
                  : "Sert à personnaliser les emails. Mémorisée pour vos prochaines recherches."
              }
              icon={<Briefcase className="size-4" />}
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <Label>Votre entreprise</Label>
                <Input value={offer.senderCompany} onChange={(e) => setO("senderCompany", e.target.value)} placeholder="Acme Studio" />
              </div>
              <div>
                <Label>Signataire</Label>
                <Input value={offer.senderName} onChange={(e) => setO("senderName", e.target.value)} placeholder="Camille Martin" />
              </div>
              <div className="sm:col-span-2">
                <Label>Ce que vous vendez</Label>
                <Input value={offer.product} onChange={(e) => setO("product", e.target.value)} placeholder="Refonte de sites e-commerce orientée conversion" />
              </div>
              <div className="sm:col-span-2">
                <Label hint="(bénéfice concret, preuve, chiffre)">Proposition de valeur</Label>
                <Textarea
                  rows={2}
                  value={offer.valueProposition}
                  onChange={(e) => setO("valueProposition", e.target.value)}
                  placeholder="Nous augmentons le taux de conversion de 20 à 40 % en 8 semaines, comme pour Maison Lumière."
                />
              </div>
              <div>
                <Label>Appel à l&apos;action</Label>
                <Input value={offer.callToAction} onChange={(e) => setO("callToAction", e.target.value)} />
              </div>
              <div>
                <Label hint="(Calendly, Cal.com, Google Agenda…)">Lien de prise de rendez-vous</Label>
                <Input type="url" value={offer.bookingUrl} onChange={(e) => setO("bookingUrl", e.target.value)} placeholder="https://calendly.com/vous/15min" />
              </div>
              <div>
                <Label>Ton</Label>
                <Input value={offer.tone} onChange={(e) => setO("tone", e.target.value)} />
              </div>
              <div>
                <Label>Langue des emails</Label>
                <select
                  value={offer.language}
                  onChange={(e) => setO("language", e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none"
                >
                  <option value="auto">Automatique (langue du prospect)</option>
                  <option value="fr">Français</option>
                  <option value="en">Anglais</option>
                  <option value="es">Espagnol</option>
                  <option value="de">Allemand</option>
                  <option value="it">Italien</option>
                  <option value="nl">Néerlandais</option>
                </select>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Volume et automatisation"
              icon={<Settings2 className="size-4" />}
              action={
                <button type="button" className="text-sm font-medium text-brand-600" onClick={() => setShowAdvanced((v) => !v)}>
                  {showAdvanced ? "Masquer les options avancées" : "Options avancées"}
                </button>
              }
            />
            <div className="grid gap-5 p-5 sm:grid-cols-3">
              <div>
                <Label hint={`${settings.targetCompanies}`}>Entreprises qualifiées visées</Label>
                <input type="range" min={5} max={200} step={5} value={settings.targetCompanies} onChange={(e) => setS("targetCompanies", Number(e.target.value))} className="w-full accent-brand-600" />
              </div>
              <div>
                <Label hint={`${settings.contactsPerCompany}`}>Décideurs par entreprise</Label>
                <input type="range" min={1} max={5} value={settings.contactsPerCompany} onChange={(e) => setS("contactsPerCompany", Number(e.target.value))} className="w-full accent-brand-600" />
              </div>
              <div>
                <Label hint={`${settings.minScore}/100`}>Score ICP minimum</Label>
                <input type="range" min={30} max={90} step={5} value={settings.minScore} onChange={(e) => setS("minScore", Number(e.target.value))} className="w-full accent-brand-600" />
              </div>
              <div className="sm:col-span-3 grid gap-4 sm:grid-cols-2">
                <Toggle
                  checked={settings.deepResearch}
                  onChange={(v) => setS("deepResearch", v)}
                  label="Recherche approfondie"
                  hint="Signaux d'achat récents et décideurs recherchés en profondeur (plus précis, un peu plus long)."
                />
                <Toggle checked={settings.autoWrite} onChange={(v) => setS("autoWrite", v)} label="Rédaction automatique" hint="Une séquence personnalisée est rédigée pour chaque lead trouvé." />
                <div className="sm:col-span-2 space-y-3 rounded-xl border border-brand-100 bg-brand-50/40 p-4">
                  <Toggle
                    checked={!!settings.visualSample}
                    onChange={(v) => setS("visualSample", v)}
                    label="Offrir un visuel personnalisé à chaque prospect"
                    hint="L'agent crée un visuel promo à l'image de chaque entreprise qualifiée et le glisse dans le premier email. Donner avant de demander fait nettement plus répondre."
                  />
                  {settings.visualSample && (
                    <div>
                      <Label hint="(facultatif)">Ce que montre le visuel</Label>
                      <Input
                        value={settings.visualBrief ?? ""}
                        onChange={(e) => setS("visualBrief", e.target.value)}
                        placeholder="Ex. : affiche promo pour Instagram mettant en avant leur produit phare"
                        maxLength={500}
                      />
                    </div>
                  )}
                </div>
              </div>
              {showAdvanced && (
                <>
                  <div>
                    <Label>Emails par séquence</Label>
                    <Input type="number" min={1} max={5} value={settings.sequenceSteps} onChange={(e) => setS("sequenceSteps", Number(e.target.value))} />
                  </div>
                  <div>
                    <Label>Jours entre relances</Label>
                    <Input type="number" min={1} max={30} value={settings.followUpDays} onChange={(e) => setS("followUpDays", Number(e.target.value))} />
                  </div>
                  <div>
                    <Label hint="(n8n, Make, Zapier, CRM)">Webhook de fin de campagne</Label>
                    <Input value={settings.webhookUrl} onChange={(e) => setS("webhookUrl", e.target.value)} placeholder="https://…" />
                  </div>
                  <div className="sm:col-span-3">
                    <Label hint="(l'agent cherchera des entreprises similaires — sosies)">Exemples de clients idéaux</Label>
                    <ChipsEditor values={settings.seedDomains} onChange={(v) => setS("seedDomains", v)} placeholder="client-modele.fr, autre-client.com…" />
                  </div>
                </>
              )}
            </div>
          </Card>

          <div className="flex justify-end">
            {mode === "link" ? (
              <Button
                size="lg"
                onClick={analyzeLink}
                loading={loading === "plan"}
                disabled={link.url.trim().length < 4 || link.country.trim().length < 2}
                icon={<Wand2 className="size-4" />}
              >
                {loading === "plan" ? "L'agent lit le lien…" : "Analyser le lien"}
              </Button>
            ) : (
              <Button size="lg" onClick={analyze} loading={loading === "plan"} disabled={prompt.trim().length < 8} icon={<Wand2 className="size-4" />}>
                {loading === "plan" ? "L'IA analyse votre cible…" : "Analyser avec l'IA"}
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          {(plan.feasible === false || !plan.searchQueries.some((q) => q.trim())) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-semibold">Cette demande ne permet pas de cibler des entreprises</div>
              <p className="mt-1">
                {plan.feasibilityIssue ||
                  "Le plan ne contient aucune requête de recherche. Décrivez des entreprises ou organisations à prospecter (secteur, zone, taille, situation)."}
              </p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => setPlan(null)} icon={<ArrowLeft className="size-4" />}>
                Reformuler la demande
              </Button>
            </div>
          )}
          {linkInfo && <LinkSummary info={linkInfo} onChange={setLinkInfo} offer={offer} setOffer={setO} />}
          <Card>
            <CardHeader title="Ciblage" subtitle={`« ${prompt} »`} icon={<Bot className="size-4" />} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Nom de la campagne</Label>
                <Input value={plan.campaignName} onChange={(e) => setP("campaignName", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label>Client idéal (résumé)</Label>
                <Textarea rows={2} value={plan.summary} onChange={(e) => setP("summary", e.target.value)} />
              </div>
              <div>
                <Label>Secteurs</Label>
                <ChipsEditor values={plan.industries} onChange={(v) => setP("industries", v)} />
              </div>
              <div>
                <Label>Zones géographiques</Label>
                <ChipsEditor values={plan.geographies} onChange={(v) => setP("geographies", v)} />
              </div>
              <div>
                <Label>Taille d&apos;entreprise</Label>
                <Input value={plan.companySize} onChange={(e) => setP("companySize", e.target.value)} />
              </div>
              <div>
                <Label>Mots-clés</Label>
                <ChipsEditor values={plan.keywords} onChange={(v) => setP("keywords", v)} />
              </div>
              <div className="sm:col-span-2">
                <Label hint="(par ordre de priorité)">Décideurs à contacter</Label>
                <ChipsEditor values={plan.personas} onChange={(v) => setP("personas", v)} />
              </div>
              <div>
                <Label>Signaux d&apos;achat recherchés</Label>
                <ChipsEditor values={plan.signals} onChange={(v) => setP("signals", v)} />
              </div>
              <div>
                <Label>Exclusions</Label>
                <ChipsEditor values={plan.exclusions} onChange={(v) => setP("exclusions", v)} />
              </div>
              <div className="sm:col-span-2">
                <Label>Critères de qualification</Label>
                <ChipsEditor values={plan.qualificationCriteria} onChange={(v) => setP("qualificationCriteria", v)} />
              </div>
              <div className="sm:col-span-2">
                <Label hint="(une par ligne)">Requêtes de recherche</Label>
                <Textarea
                  rows={6}
                  className="font-mono text-xs"
                  value={plan.searchQueries.join("\n")}
                  onChange={(e) => setP("searchQueries", e.target.value.split("\n"))}
                  onBlur={() => setP("searchQueries", plan.searchQueries.map((q) => q.trim()).filter(Boolean))}
                />
              </div>
            </div>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setPlan(null)} icon={<ArrowLeft className="size-4" />}>
              Modifier la demande
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">
                Objectif : {finalSettings().targetCompanies} entreprises · {settings.contactsPerCompany} décideur(s) chacune
              </span>
              <Button
                size="lg"
                onClick={launch}
                loading={loading === "launch"}
                disabled={plan.feasible === false || !plan.searchQueries.some((q) => q.trim())}
                icon={<Rocket className="size-4" />}
              >
                Lancer la prospection
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Ce que le lien a apporté : liste importée, entreprise exemple ou offre déduite du site. */
function LinkSummary({
  info,
  onChange,
  offer,
  setOffer,
}: {
  info: LinkInfo;
  onChange: (i: LinkInfo) => void;
  offer: CampaignOffer;
  setOffer: (k: keyof CampaignOffer, v: string) => void;
}) {
  if (info.kind === "own") {
    return (
      <Card>
        <CardHeader title="Votre offre, déduite de votre site" subtitle="Elle sert à écrire les emails : corrigez-la si besoin." icon={<Building2 className="size-4" />} />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <Label>Votre entreprise</Label>
            <Input value={offer.senderCompany} onChange={(e) => setOffer("senderCompany", e.target.value)} />
          </div>
          <div>
            <Label>Signataire</Label>
            <Input value={offer.senderName} onChange={(e) => setOffer("senderName", e.target.value)} placeholder="Prénom Nom" />
          </div>
          <div className="sm:col-span-2">
            <Label>Ce que vous vendez</Label>
            <Input value={offer.product} onChange={(e) => setOffer("product", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Proposition de valeur</Label>
            <Textarea rows={2} value={offer.valueProposition} onChange={(e) => setOffer("valueProposition", e.target.value)} />
          </div>
        </div>
      </Card>
    );
  }

  if (info.kind === "target") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900">
        <Target className="mt-0.5 size-4 shrink-0" />
        <p>
          L&apos;agent prospecte <strong>{info.title}</strong>, puis cherche des entreprises similaires en <strong>{info.country}</strong>.
        </p>
      </div>
    );
  }

  const remove = (i: number) => onChange({ ...info, companies: info.companies.filter((_, j) => j !== i) });
  return (
    <Card>
      <CardHeader
        title={`Entreprises de votre liste (${info.companies.length})`}
        subtitle={`${info.title} · ${info.country}`}
        icon={<ListChecks className="size-4" />}
      />
      <div className="space-y-4 p-5">
        {info.outsideCountry > 0 && (
          <p className="text-sm text-slate-500">
            {info.outsideCountry} entreprise(s) situées hors de ce pays ont été écartées.
          </p>
        )}
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {info.companies.map((c, i) => (
            <li key={`${c.domain}-${c.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-900">{c.name}</div>
                <div className="truncate text-xs text-slate-500">{c.domain || "site retrouvé automatiquement"}</div>
              </div>
              <button type="button" onClick={() => remove(i)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Retirer ${c.name}`}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <Toggle
          checked={info.importOnly}
          onChange={(v) => onChange({ ...info, importOnly: v })}
          label="Prospecter uniquement ces entreprises"
          hint={`Désactivé : l'agent cherche aussi des entreprises similaires en ${info.country}.`}
        />
      </div>
    </Card>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NewCampaign />
    </Suspense>
  );
}
