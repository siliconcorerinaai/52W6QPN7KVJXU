import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorMessage } from "@/lib/util";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Enveloppe un handler : erreurs → JSON propre. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ZodError) return json({ error: "Données invalides", details: e.issues }, 400);
    console.error("[api]", e);
    return json({ error: errorMessage(e) }, 500);
  }
}

export type IdParams = { params: Promise<{ id: string }> };
