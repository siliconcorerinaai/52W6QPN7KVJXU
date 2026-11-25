import { headers } from "next/headers";

/**
 * Rôle de la requête, posé par src/proxy.ts à partir du mot de passe saisi (jamais par le navigateur).
 * « admin » : le propriétaire, qui voit la configuration technique (fournisseurs, coûts, erreurs détaillées).
 * « user » : les utilisateurs, à qui l'application n'expose aucun détail technique.
 */
export const ROLE_HEADER = "x-prospecta-role";
export type Role = "admin" | "user";

export async function currentRole(): Promise<Role> {
  try {
    return (await headers()).get(ROLE_HEADER) === "admin" ? "admin" : "user";
  } catch {
    // Hors d'une requête HTTP (worker, scripts) : aucun utilisateur à protéger.
    return "admin";
  }
}

export async function isAdmin(): Promise<boolean> {
  return (await currentRole()) === "admin";
}

/** Statistiques sans les coûts internes (réservés à l'administrateur). */
export function publicStats<T extends { costUsd?: number; webSearches?: number }>(stats: T): Omit<T, "costUsd" | "webSearches"> {
  const { costUsd: _c, webSearches: _w, ...rest } = stats;
  return rest;
}

/** Retire des données d'un événement les détails techniques réservés à l'administrateur. */
export function publicEventData(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const { tech: _tech, ...rest } = data as Record<string, unknown>;
  return rest;
}
