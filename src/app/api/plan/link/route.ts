import { z } from "zod";
import { intelligence } from "@/lib/ai";
import { handle, json } from "@/lib/api";
import { assertPublicUrl } from "@/lib/net-guard";
import { PlanError } from "@/lib/pipeline/campaigns";
import { normalizeUserUrl, readLinkPage } from "@/lib/scrape/link";
import { crawlCompanySite } from "@/lib/scrape/site";
import { requireUser } from "@/lib/session";
import { CampaignOfferSchema, LINK_KINDS } from "@/lib/types";

export const maxDuration = 180;

const Body = z.object({
  url: z.string().min(4, "Collez un lien").max(2000),
  kind: z.enum(LINK_KINDS),
  country: z.string().trim().min(2, "Choisissez un pays").max(80),
  offer: CampaignOfferSchema.partial().default({}),
});

/**
 * Prospection à partir d'un lien : le site de l'utilisateur (son offre → ses clients idéaux),
 * une page qui liste des entreprises (on les extrait) ou le site d'une entreprise cible (on cherche ses sosies),
 * toujours dans le pays choisi.
 */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = Body.parse(await req.json());
    const url = normalizeUserUrl(body.url);
    if (!url) throw new PlanError("Ce lien n'est pas valide. Exemple : https://www.exemple.com");
    try {
      await assertPublicUrl(url);
    } catch {
      throw new PlanError("Ce lien est inaccessible. Vérifiez l'adresse.");
    }

    const page = body.kind === "list" ? await readLinkPage(url) : null;
    if (body.kind === "list" && (!page || (page.text.length < 200 && page.links.length < 3))) {
      throw new PlanError(
        "Impossible de lire la liste sur cette page (page protégée ou affichée par un script). Essayez un autre lien, ou une autre page de la même liste.",
      );
    }
    const site = body.kind === "list" ? null : await crawlCompanySite(url, 5);

    const result = await intelligence().fromLink(
      { kind: body.kind, url, country: body.country, offer: { ...CampaignOfferSchema.parse({}), ...body.offer }, site, page },
      {},
    );
    if (body.kind === "list" && !result.companies.length) {
      throw new PlanError(
        result.outsideCountry
          ? `Les ${result.outsideCountry} entreprises de cette page sont hors de ce pays (${body.country}). Choisissez un autre pays ou une autre liste.`
          : "Aucune entreprise n'a été trouvée sur cette page. Essayez un autre lien.",
      );
    }
    return json(result);
  });
}
