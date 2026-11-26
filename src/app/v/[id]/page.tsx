import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { campaigns, companies, samples } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const TEXT = {
  fr: {
    title: (c: string) => `Un visuel créé pour ${c}`,
    from: (s: string) => `Offert par ${s}, sans engagement.`,
    cta: "Il vous plaît ? Répondez simplement à notre email : nous vous préparons la version finale, ou une vidéo dans le même style.",
    book: "Prendre rendez-vous",
    download: "Télécharger le visuel",
  },
  en: {
    title: (c: string) => `A visual made for ${c}`,
    from: (s: string) => `A free sample from ${s}, no strings attached.`,
    cta: "Like it? Just reply to our email: we'll prepare the final version, or a video in the same style.",
    book: "Book a call",
    download: "Download the visual",
  },
};

async function load(id: string) {
  if (!/^[\w-]{10,40}$/.test(id)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ status: samples.status, language: samples.language, company: companies.name, offer: campaigns.offer })
    .from(samples)
    .innerJoin(companies, eq(companies.id, samples.companyId))
    .innerJoin(campaigns, eq(campaigns.id, samples.campaignId))
    .where(eq(samples.id, id));
  return row && row.status === "ready" ? row : null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const row = await load((await params).id);
  const t = TEXT[row?.language?.startsWith("fr") ? "fr" : "en"];
  return { title: row ? t.title(row.company) : "Visuel", robots: { index: false, follow: false } };
}

/** Page publique d'un visuel offert : le prospect y arrive depuis le premier email. */
export default async function SamplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await load(id);
  if (!row) notFound();
  const t = TEXT[row.language?.startsWith("fr") ? "fr" : "en"];
  const sender = row.offer.senderCompany || row.offer.senderName;
  const image = `/v/${id}/image`;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-900">{t.title(row.company)}</h1>
        {sender && <p className="mt-1 text-center text-sm text-slate-500">{t.from(sender)}</p>}
        <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element -- image servie telle quelle, déjà optimisée */}
          <img src={image} alt={t.title(row.company)} className="block h-auto w-full" />
        </div>
        <p className="mt-6 text-center text-slate-700">{t.cta}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {row.offer.bookingUrl && /^https?:\/\//.test(row.offer.bookingUrl) && (
            <a
              href={row.offer.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
            >
              {t.book}
            </a>
          )}
          <a href={image} download className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100">
            {t.download}
          </a>
        </div>
      </div>
    </main>
  );
}
