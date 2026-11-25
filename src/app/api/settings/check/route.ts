import { handle, json } from "@/lib/api";
import { checkProviderKeys } from "@/lib/provider-check";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Teste les clés d'API configurées (administrateur uniquement). */
export async function POST() {
  return handle(async () => {
    await requireAdmin();
    return json({ results: await checkProviderKeys() });
  });
}
