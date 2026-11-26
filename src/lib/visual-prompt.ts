/** Consigne du visuel offert aux prospects (module sans dépendance, utilisé par l'IA et par le pipeline). */
import type { Company } from "@/lib/db/schema";

export const DEFAULT_VISUAL_BRIEF = "une affiche promotionnelle carrée pour les réseaux sociaux, qui donne envie de venir";

const LANGUAGE_NAMES: Record<string, string> = {
  fr: "French",
  en: "English",
  es: "Spanish",
  de: "German",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
};

/** Consigne envoyée au modèle d'images (en anglais : ces modèles la suivent mieux). */
export function visualPrompt(company: Pick<Company, "name" | "industry" | "location" | "country" | "description" | "language">, brief: string): string {
  const language = LANGUAGE_NAMES[(company.language ?? "").slice(0, 2).toLowerCase()] ?? "English";
  const where = [company.location, company.country].filter((x) => x && x !== "inconnu").join(", ");
  return [
    "Create a premium promotional visual for a real local business, ready to post on social media.",
    `Business: "${company.name}"${company.industry ? ` — ${company.industry}` : ""}${where ? `, ${where}` : ""}.`,
    company.description ? `What they do: ${company.description}` : "",
    `What the visual should be (the client's request, may be in French): ${brief || DEFAULT_VISUAL_BRIEF}.`,
    "Requirements:",
    "- High-end advertising look: professional lighting, inviting, realistic products, people or premises typical of this business.",
    `- Show the business name "${company.name}" as a clean headline, spelled exactly; at most one short tagline in ${language}.`,
    "- No prices, phone numbers, addresses, website URLs, QR codes or logos of other brands.",
    "- Clean, uncluttered composition, square format.",
  ]
    .filter(Boolean)
    .join("\n");
}

