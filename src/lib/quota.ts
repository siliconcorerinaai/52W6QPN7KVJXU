/**
 * Quota mensuel par compte : nombre d'entreprises analysées (découvertes) par mois civil.
 * Il protège la plateforme des coûts de recherche et d'IA. 0 = illimité ; les administrateurs
 * et les données sans propriétaire ne sont pas limités.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { campaigns, companies, users } from "@/lib/db/schema";

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Entreprises découvertes ce mois-ci pour l'ensemble des campagnes du compte. */
export async function companiesThisMonth(userId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(companies)
    .innerJoin(campaigns, eq(campaigns.id, companies.campaignId))
    .where(and(eq(campaigns.userId, userId), gte(companies.createdAt, startOfMonth())));
  return row?.n ?? 0;
}

export type Quota = { limit: number; used: number; remaining: number };

/** Quota restant pour le propriétaire d'une campagne (Infinity si illimité). */
export async function quotaForCampaignOwner(userId: string | null): Promise<Quota> {
  if (!userId) return { limit: 0, used: 0, remaining: Infinity };
  const db = await getDb();
  const [u] = await db.select({ role: users.role, limit: users.monthlyCompanyLimit }).from(users).where(eq(users.id, userId));
  if (!u || u.role === "admin" || u.limit <= 0) return { limit: 0, used: 0, remaining: Infinity };
  const used = await companiesThisMonth(userId);
  return { limit: u.limit, used, remaining: Math.max(0, u.limit - used) };
}
