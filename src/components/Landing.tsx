import Link from "next/link";
import { Building2, CheckCircle2, MailCheck, MessageSquareReply, PenLine, Radar, ShieldCheck, Sparkles, Users } from "lucide-react";
import { BRAND } from "@/lib/brand";

const STEPS = [
  { n: "1", title: "Décrivez votre client idéal", text: "Une phrase suffit : secteur, zone, taille, ce que vous vendez." },
  { n: "2", title: "L'agent trouve et qualifie", text: "Entreprises correspondantes, notées selon votre cible, avec les raisons." },
  { n: "3", title: "Décideurs et emails vérifiés", text: "Les bonnes personnes, avec des adresses vérifiées avant tout envoi." },
  { n: "4", title: "Séquences personnalisées", text: "Des emails écrits pour chaque prospect, envoyés depuis votre boîte." },
];

const FEATURES = [
  { icon: Building2, title: "Entreprises ciblées", text: "Recherche en direct, au-delà des bases figées, avec un score de pertinence." },
  { icon: Users, title: "Décideurs identifiés", text: "Les personnes qui décident vraiment, avec leur rôle et leurs signaux récents." },
  { icon: MailCheck, title: "Emails vérifiés", text: "Chaque adresse est contrôlée pour protéger votre réputation d'expéditeur." },
  { icon: PenLine, title: "Messages sur mesure", text: "Chaque email part d'un fait réel sur l'entreprise, pas d'un modèle générique." },
  { icon: MessageSquareReply, title: "Relances et réponses", text: "Relances automatiques, arrêtées dès qu'un prospect répond." },
  { icon: ShieldCheck, title: "Prospection responsable", text: "B2B uniquement, désinscription en un clic, liste d'exclusion intégrée." },
];

/** Page d'accueil publique (visiteurs non connectés). */
export function Landing() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow">
            <Radar className="size-4.5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{BRAND.name}</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-2 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">
            Se connecter
          </Link>
          <Link href="/signup" className="rounded-lg bg-brand-600 px-3.5 py-2 font-medium text-white shadow-sm hover:bg-brand-700">
            Essayer
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-8 md:pt-16">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-indigo-600 to-violet-700 px-6 py-14 text-white shadow-xl md:px-14 md:py-20">
          <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-white/10 blur-3xl" />
          <div className="relative max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
              <Sparkles className="size-3.5" /> {BRAND.tagline}
            </div>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">Décrivez votre client idéal. {BRAND.name} trouve vos prochains clients.</h1>
            <p className="mt-4 max-w-2xl text-lg text-white/85">
              Entreprises qualifiées, décideurs, emails vérifiés et séquences personnalisées : tout le travail de prospection, en une phrase.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-brand-700 shadow hover:bg-brand-50">
                Créer mon compte
              </Link>
              <Link href="/login" className="rounded-xl bg-white/15 px-5 py-3 text-sm font-semibold text-white hover:bg-white/25">
                J&apos;ai déjà un compte
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
        <h2 className="text-2xl font-semibold tracking-tight">Comment ça marche</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-slate-200 p-5">
              <div className="grid size-8 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{s.n}</div>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 py-16">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <h2 className="text-2xl font-semibold tracking-tight">Tout pour prospecter, sans le travail fastidieux</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5">
                <Icon className="size-5 text-brand-600" />
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center md:px-8">
        <h2 className="text-2xl font-semibold tracking-tight">Prêt à trouver vos prochains clients ?</h2>
        <ul className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-600">
          {["Sans engagement", "Vos emails partent de votre propre boîte", "Vos données restent les vôtres"].map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-500" /> {t}
            </li>
          ))}
        </ul>
        <Link href="/signup" className="mt-8 inline-block rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow hover:bg-brand-700">
          Créer mon compte
        </Link>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} {BRAND.name} · Prospection B2B responsable
      </footer>
    </div>
  );
}
