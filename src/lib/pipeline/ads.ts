/**
 * Publicité Facebook / Instagram ciblée : les prospects d'une campagne (ou de toutes) au format
 * « liste de clients » de Meta, à importer dans le Gestionnaire de publicités comme audience personnalisée,
 * et des textes d'annonce rédigés par l'IA. Meta chiffre (hache) les données dans le navigateur à l'import.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { intelligence } from "@/lib/ai";
import type { AdCopy } from "@/lib/ai/schemas";
import { isoCountry } from "@/lib/countries";
import { getDb } from "@/lib/db";
import { appState, campaigns, companies, contacts, suppressions } from "@/lib/db/schema";
import { campaignIdsOf, type Owner } from "@/lib/ownership";
import { splitName } from "@/lib/util";
import { toCsv } from "./export";

/** En dessous, Meta ne diffuse pas une audience personnalisée. */
export const META_MIN_AUDIENCE = 100;

export type AudienceRow = { email: string; fn: string; ln: string; ct: string; country: string };

/**
 * Prospects à cibler : adresse utilisable, ni désinscrits ni en rebond, ni dans la liste d'exclusion.
 * Une campagne, ou toutes celles du compte (une audience Meta doit compter au moins 100 personnes).
 */
export async function audienceRows(owner: Owner, campaignId: string | null): Promise<AudienceRow[]> {
  const db = await getDb();
  const scope = campaignId ? eq(contacts.campaignId, campaignId) : inArray(contacts.campaignId, campaignIdsOf(owner));
  const rows = await db
    .select({ email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName, fullName: contacts.fullName, location: companies.location, country: companies.country })
    .from(contacts)
    .innerJoin(companies, eq(companies.id, contacts.companyId))
    .where(
      and(
        scope,
        isNotNull(contacts.email),
        inArray(contacts.emailStatus, ["valid", "risky", "catch_all", "unknown"]),
        inArray(contacts.status, ["ready", "drafted", "approved", "sent", "replied"]),
      ),
    );
  const excluded = new Set(
    (await db.select({ value: suppressions.value }).from(suppressions).where(inArray(suppressions.userId, [owner.id, ""]))).map((s) => s.value.toLowerCase()),
  );
  const seen = new Set<string>();
  const out: AudienceRow[] = [];
  for (const r of rows) {
    const email = r.email!.trim().toLowerCase();
    if (seen.has(email) || excluded.has(email) || excluded.has(`@${email.split("@")[1]}`)) continue;
    seen.add(email);
    const name = r.firstName || r.lastName ? { first: r.firstName ?? "", last: r.lastName ?? "" } : splitName(r.fullName);
    out.push({
      email,
      fn: name.first ?? "",
      ln: name.last ?? "",
      ct: (r.location ?? "").split(",")[0].trim().replace(/^inconnu$/i, ""),
      country: isoCountry(r.country) ?? "",
    });
  }
  return out;
}

/** Fichier CSV au format « liste de clients » de Meta (en-têtes reconnus automatiquement à l'import). */
export function audienceCsv(rows: AudienceRow[]): string {
  return toCsv(["email", "fn", "ln", "ct", "country"], rows.map((r) => [r.email, r.fn, r.ln, r.ct, r.country])).replace(/^﻿/, "");
}

const adKey = (campaignId: string) => `adcopy:${campaignId}`;

export async function savedAdCopy(campaignId: string): Promise<AdCopy | null> {
  const db = await getDb();
  const [row] = await db.select().from(appState).where(eq(appState.key, adKey(campaignId)));
  return (row?.value as AdCopy | undefined) ?? null;
}

/** Textes d'annonce rédigés par l'IA pour l'offre de la campagne (gardés pour les réafficher). */
export async function generateAdCopy(campaignId: string): Promise<AdCopy> {
  const db = await getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) throw new Error("Campagne introuvable");
  const language = c.offer.language && c.offer.language !== "auto" ? c.offer.language : /united states|états-unis|canada|kingdom|royaume/i.test(c.plan.geographies.join(" ")) ? "en" : "fr";
  const copy = await intelligence().writeAdCopy({ offer: c.offer, plan: c.plan, language }, { campaignId });
  await db
    .insert(appState)
    .values({ key: adKey(campaignId), value: copy })
    .onConflictDoUpdate({ target: appState.key, set: { value: copy, updatedAt: new Date() } });
  return copy;
}
