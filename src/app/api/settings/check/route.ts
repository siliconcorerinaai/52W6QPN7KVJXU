import { handle, json } from "@/lib/api";
import { checkProviderKeys } from "@/lib/provider-check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Teste les clés d'API configurées (un appel léger par service). */
export async function POST() {
  return handle(async () => json({ results: await checkProviderKeys() }));
}
