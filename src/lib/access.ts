import { currentUser } from "@/lib/session";

/**
 * Rôle de la personne connectée.
 * « admin » : le propriétaire de la plateforme, qui voit la configuration technique (fournisseurs,
 * coûts, erreurs détaillées) et gère les comptes. « user » : les clients, à qui l'application
 * n'expose aucun détail technique.
 */
export async function isAdmin(): Promise<boolean> {
  return (await currentUser())?.role === "admin";
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
