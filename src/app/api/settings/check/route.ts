import { handle, json } from "@/lib/api";
import { isAdmin } from "@/lib/access";
import { checkProviderKeys } from "@/lib/provider-check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Teste les clés d'API configurées (administrateur uniquement). */
export async function POST() {
  return handle(async () => {
    if (!(await isAdmin())) return json({ error: "Réservé à l'administrateur." }, 403);
    return json({ results: await checkProviderKeys() });
  });
}
