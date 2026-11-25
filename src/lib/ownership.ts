/**
 * Propriété des données : chaque campagne, boîte d'envoi et exclusion appartient à un compte.
 * Les données créées avant les comptes (sans propriétaire) et la boîte par défaut de la plateforme
 * reviennent aux administrateurs.
 */
import { eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { campaigns, users } from "@/lib/db/schema";

export type Owner = { id: string; role: "user" | "admin" };

/** Ressource inexistante ou appartenant à un autre compte (réponse 404, sans dire laquelle des deux). */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}

export function canAccess(ownerId: string | null | undefined, owner: Owner): boolean {
  return ownerId === owner.id || (!ownerId && owner.role === "admin");
}

/** Condition SQL : campagnes accessibles au compte. */
export function campaignScope(owner: Owner): SQL {
  return owner.role === "admin" ? or(eq(campaigns.userId, owner.id), isNull(campaigns.userId))! : eq(campaigns.userId, owner.id);
}

/** La plateforme elle-même (boîte par défaut, données sans propriétaire) : campagnes des administrateurs. */
export const PLATFORM: Owner = { id: "", role: "admin" };

/** Sous-requête des identifiants de campagnes accessibles au compte. */
export function campaignIdsOf(owner: Owner): SQL {
  if (!owner.id) {
    return sql`(select ${campaigns.id} from ${campaigns} where ${campaigns.userId} is null or ${campaigns.userId} in (select ${users.id} from ${users} where ${users.role} = 'admin'))`;
  }
  return owner.role === "admin"
    ? sql`(select ${campaigns.id} from ${campaigns} where ${campaigns.userId} = ${owner.id} or ${campaigns.userId} is null)`
    : sql`(select ${campaigns.id} from ${campaigns} where ${campaigns.userId} = ${owner.id})`;
}

/** Propriétaire d'une campagne (pour le worker, qui agit sans session). */
export async function campaignOwner(campaignId: string): Promise<Owner> {
  const db = await getDb();
  const [row] = await db
    .select({ userId: campaigns.userId, role: users.role })
    .from(campaigns)
    .leftJoin(users, eq(users.id, campaigns.userId))
    .where(eq(campaigns.id, campaignId));
  if (!row?.userId) return PLATFORM;
  return { id: row.userId, role: row.role ?? "user" };
}
