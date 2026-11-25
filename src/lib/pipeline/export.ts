import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { companies, contacts, type Company, type Contact } from "@/lib/db/schema";
import { assertPublicUrl } from "@/lib/net-guard";

export type LeadRow = { contact: Contact; company: Company };

export async function loadLeads(campaignId: string, onlyWithEmail = false): Promise<LeadRow[]> {
  const db = await getDb();
  const conds = [eq(contacts.campaignId, campaignId)];
  if (onlyWithEmail) conds.push(inArray(contacts.emailStatus, ["valid", "risky", "catch_all"]));
  const rows = await db
    .select({ contact: contacts, company: companies })
    .from(contacts)
    .innerJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(...conds));
  return rows.sort((a, b) => (b.company.score ?? 0) - (a.company.score ?? 0) || b.contact.relevance - a.contact.relevance);
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : Array.isArray(v) ? v.join(" | ") : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // BOM pour qu'Excel ouvre correctement l'UTF-8
  return "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function leadsToCsv(leads: LeadRow[]): string {
  return toCsv(
    [
      "Prénom", "Nom", "Nom complet", "Poste", "Email", "Statut email", "Confiance email", "LinkedIn",
      "Entreprise", "Domaine", "Site", "Secteur", "Effectif", "Ville", "Pays", "Score ICP", "Raisons",
      "Signaux", "Technologies", "Statut lead",
    ],
    leads.map(({ contact: c, company: co }) => [
      c.firstName, c.lastName, c.fullName, c.title, c.email, c.emailStatus, c.emailConfidence, c.linkedinUrl,
      co.name, co.domain, co.website, co.industry, co.employeeRange, co.location, co.country, co.score,
      co.scoreReasons, co.signals.map((s) => s.text), co.techStack, c.status,
    ]),
  );
}

export async function companiesToCsv(campaignId: string): Promise<string> {
  const db = await getDb();
  const rows = await db.select().from(companies).where(eq(companies.campaignId, campaignId));
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return toCsv(
    ["Entreprise", "Domaine", "Site", "Statut", "Score ICP", "Secteur", "Effectif", "Ville", "Pays", "Description", "Raisons", "Signaux", "Technologies", "LinkedIn", "Emails publics", "Motif email"],
    rows.map((co) => [
      co.name, co.domain, co.website, co.status, co.score, co.industry, co.employeeRange, co.location, co.country,
      co.description, co.scoreReasons, co.signals.map((s) => s.text), co.techStack, co.linkedinUrl, co.siteEmails, co.emailPattern,
    ]),
  );
}

/** Pousse les leads (avec email) vers un webhook : n8n, Make, Zapier, CRM maison… */
export async function pushWebhook(campaignId: string, url: string): Promise<number> {
  await assertPublicUrl(url);
  const leads = await loadLeads(campaignId, true);
  const payload = {
    source: "ciblora",
    campaignId,
    count: leads.length,
    leads: leads.map(({ contact: c, company: co }) => ({
      firstName: c.firstName,
      lastName: c.lastName,
      fullName: c.fullName,
      title: c.title,
      email: c.email,
      emailStatus: c.emailStatus,
      emailConfidence: c.emailConfidence,
      linkedinUrl: c.linkedinUrl,
      company: {
        name: co.name,
        domain: co.domain,
        website: co.website,
        industry: co.industry,
        employeeRange: co.employeeRange,
        location: co.location,
        country: co.country,
        score: co.score,
        reasons: co.scoreReasons,
        signals: co.signals,
        techStack: co.techStack,
      },
    })),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "error", // pas de redirection vers une adresse interne
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
  return leads.length;
}
