import { getDb } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";

export type AiContext = { campaignId?: string | null };

export type UsageRecord = {
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  webSearches?: number;
  costUsd: number;
};

/** Enregistre la consommation d'un appel IA (affichée par campagne et sur le tableau de bord). */
export async function saveUsage(ctx: AiContext, u: UsageRecord) {
  try {
    const db = await getDb();
    await db.insert(aiUsage).values({
      campaignId: ctx.campaignId ?? null,
      operation: u.operation,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens ?? 0,
      webSearches: u.webSearches ?? 0,
      costUsd: u.costUsd,
    });
  } catch (e) {
    console.error("[ai] usage non enregistré", e);
  }
}
