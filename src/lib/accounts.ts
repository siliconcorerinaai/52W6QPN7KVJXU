import { sql } from "drizzle-orm";
import { getDb, rowsOf } from "@/lib/db";
import { startOfMonth } from "@/lib/quota";

export type AccountRow = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  disabled: boolean;
  monthlyCompanyLimit: number;
  createdAt: string;
  lastLoginAt: string | null;
  campaigns: number;
  companiesThisMonth: number;
  costThisMonth: number;
};

/** Comptes avec leur usage du mois en cours (page Administration). */
export async function listAccounts(): Promise<AccountRow[]> {
  const db = await getDb();
  const month = startOfMonth().toISOString();
  const res = await db.execute(sql`
    select u.id, u.email, u.name, u.role, u.disabled,
      u.monthly_company_limit as "monthlyCompanyLimit", u.created_at as "createdAt", u.last_login_at as "lastLoginAt",
      (select count(*)::int from prospecta.campaigns c where c.user_id = u.id) as "campaigns",
      (select count(*)::int from prospecta.companies co join prospecta.campaigns c on c.id = co.campaign_id
        where c.user_id = u.id and co.created_at >= ${month}::timestamptz) as "companiesThisMonth",
      (select coalesce(sum(a.cost_usd), 0)::float from prospecta.ai_usage a join prospecta.campaigns c on c.id = a.campaign_id
        where c.user_id = u.id and a.created_at >= ${month}::timestamptz) as "costThisMonth"
    from prospecta.users u
    order by u.created_at desc
    limit 1000`);
  return rowsOf<AccountRow>(res).map((r) => ({
    ...r,
    campaigns: Number(r.campaigns),
    companiesThisMonth: Number(r.companiesThisMonth),
    costThisMonth: Number(r.costThisMonth),
  }));
}
