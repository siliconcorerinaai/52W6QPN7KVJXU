import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorMessage } from "@/lib/util";
import { isAdmin } from "@/lib/access";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Enveloppe un handler : erreurs → JSON propre. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ZodError) return json({ error: "Données invalides", details: e.issues }, 400);
    if (e instanceof Error && e.name === "PlanError") return json({ error: e.message }, 400);
    console.error("[api]", e);
    // Le détail (fournisseur, base de données…) n'est montré qu'à l'administrateur.
    return json({ error: (await isAdmin()) ? errorMessage(e) : "Une erreur est survenue. Réessayez dans un instant." }, 500);
  }
}

export type IdParams = { params: Promise<{ id: string }> };
