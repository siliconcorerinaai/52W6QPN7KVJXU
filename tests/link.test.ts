/**
 * Prospection à partir d'un lien : lecture de la page, nettoyage de la liste, garde-fous réseau,
 * et import des entreprises dans une campagne (mode démo, base PGlite en mémoire).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { normalizeUserUrl, parseLinkPage, readLinkPage } from "@/lib/scrape/link";
import { fetchHtml } from "@/lib/scrape/site";
import { cleanImported, withCountry } from "@/lib/ai/llm-intelligence";

beforeAll(() => {
  process.env.DEMO_MODE = "true";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ALLOW_PRIVATE_HOSTS;
});

const LIST_HTML = `<!doctype html><html lang="fr"><head><title>Exposants 2026 — Salon Agro Abidjan</title>
<meta name="description" content="Liste des exposants"></head><body>
<nav><a href="/">Accueil</a><a href="/programme">Programme</a><a href="https://www.facebook.com/salon">Facebook</a></nav>
<h1>Exposants</h1>
<ul>
  <li><a href="https://www.cacao-plus.ci/fr/">Cacao Plus</a> — Transformation de cacao</li>
  <li><a href="https://agri-logistique.com">Agri Logistique</a> — Transport</li>
  <li><a href="https://agri-logistique.com/contact">Contact Agri Logistique</a></li>
  <li>Société Ivoirienne de Palmier (sans site)</li>
  <li><a href="mailto:info@salon.ci">Écrire</a></li>
</ul>
</body></html>`;

describe("lecture d'un lien", () => {
  it("normalise la saisie de l'utilisateur", () => {
    expect(normalizeUserUrl("acme.fr/annuaire")).toBe("https://acme.fr/annuaire");
    expect(normalizeUserUrl(" https://www.acme.ci/a#b ")).toBe("https://www.acme.ci/a");
    expect(normalizeUserUrl("ftp://acme.fr")).toBeNull();
    expect(normalizeUserUrl("pas un lien")).toBeNull();
    expect(normalizeUserUrl("")).toBeNull();
  });

  it("garde les liens vers les sites des entreprises, pas la navigation ni les réseaux", () => {
    const page = parseLinkPage(LIST_HTML, "https://www.salon-agro.ci/exposants");
    expect(page.title).toContain("Exposants 2026");
    expect(page.language).toBe("fr");
    expect(page.domain).toBe("salon-agro.ci");
    expect(page.links.map((l) => l.domain)).toEqual(["cacao-plus.ci", "agri-logistique.com"]);
    expect(page.links[0].text).toBe("Cacao Plus");
    expect(page.text).toContain("Société Ivoirienne de Palmier");
  });

  it("nettoie la liste extraite : pays, doublons, domaine de l'annuaire", () => {
    const { companies, outsideCountry } = cleanImported(
      [
        { name: "Cacao Plus", domain: "www.cacao-plus.ci", inTargetCountry: true, reason: "Cacao" },
        { name: "Cacao Plus", domain: "cacao-plus.ci", inTargetCountry: true, reason: "Doublon" },
        { name: "Paris Agro", domain: "parisagro.fr", inTargetCountry: false, reason: "France" },
        { name: "Société Ivoirienne de Palmier", domain: null, inTargetCountry: null, reason: "Huile de palme" },
        { name: "Fiche annuaire", domain: "salon-agro.ci", inTargetCountry: true, reason: "Page de l'annuaire" },
        { name: "Profil LinkedIn", domain: "linkedin.com", inTargetCountry: true, reason: "Réseau" },
      ],
      "salon-agro.ci",
      "https://www.salon-agro.ci/exposants",
    );
    expect(outsideCountry).toBe(1);
    expect(companies.map((c) => [c.name, c.domain])).toEqual([
      ["Cacao Plus", "cacao-plus.ci"],
      ["Société Ivoirienne de Palmier", ""],
      ["Fiche annuaire", ""],
      ["Profil LinkedIn", ""],
    ]);
  });

  it("ajoute le pays choisi aux zones du plan s'il manque", () => {
    expect(withCountry({ geographies: ["Abidjan"] }, "Côte d'Ivoire").geographies).toEqual(["Côte d'Ivoire", "Abidjan"]);
    expect(withCountry({ geographies: ["Côte d'Ivoire", "Abidjan"] }, "côte d'ivoire").geographies).toEqual(["Côte d'Ivoire", "Abidjan"]);
  });
});

describe("garde-fous réseau", () => {
  it("refuse les adresses internes", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await fetchHtml("http://127.0.0.1:8080/")).toBeNull();
    expect(await fetchHtml("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("contrôle chaque redirection", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    expect(await fetchHtml("http://93.184.216.34/")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("suit une redirection publique et lit la page", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/exposants" } }))
      .mockResolvedValueOnce(new Response(LIST_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
    const res = await fetchHtml("http://93.184.216.34/");
    expect(res?.finalUrl).toBe("http://93.184.216.34/exposants");
    expect(res?.html).toContain("Cacao Plus");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("prospection à partir d'une liste (mode démo)", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it("lit une vraie page, puis prospecte uniquement les entreprises de la liste", async () => {
    process.env.ALLOW_PRIVATE_HOSTS = "true";
    server = createServer((_, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(LIST_HTML);
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/exposants`;

    const page = await readLinkPage(url);
    expect(page?.links.map((l) => l.domain)).toEqual(["cacao-plus.ci", "agri-logistique.com"]);

    const { intelligence } = await import("@/lib/ai");
    const r = await intelligence().fromLink(
      { kind: "list", url, country: "Côte d'Ivoire", offer: {} as never, site: null, page },
      {},
    );
    expect(r.plan.geographies).toEqual(["Côte d'Ivoire"]);
    expect(r.companies.map((c) => c.domain)).toEqual(["cacao-plus.ci", "agri-logistique.com"]);

    const { createCampaign, getCampaign } = await import("@/lib/pipeline/campaigns");
    const { tick } = await import("@/lib/jobs/worker");
    const { getDb } = await import("@/lib/db");
    const { companies } = await import("@/lib/db/schema");

    const { campaignName, feasible, feasibilityIssue, ...plan } = r.plan;
    const c = await createCampaign({
      userId: null,
      prompt: r.prompt,
      plan,
      offer: { senderName: "Franck" },
      settings: {
        targetCompanies: 3,
        contactsPerCompany: 1,
        autoWrite: false,
        importOnly: true,
        importedCompanies: [...r.companies, { name: "Société Ivoirienne de Palmier", domain: "", reason: "Huile de palme" }],
      },
    });

    for (let i = 0; i < 80; i++) {
      await tick({ concurrency: 6, deadlineMs: 4000 });
      if ((await getCampaign(c.id))?.status === "completed") break;
      await new Promise((res) => setTimeout(res, 300));
    }
    const done = await getCampaign(c.id);
    expect(done?.status).toBe("completed");
    expect(done?.settings.importCursor).toBe(3);

    const db = await getDb();
    const rows = await db.select().from(companies).where(eq(companies.campaignId, c.id));
    // Les trois de la liste (dont celle dont le site a été retrouvé par son nom), aucune autre.
    expect(rows.map((x) => x.domain).sort()).toEqual(["agri-logistique.com", "cacao-plus.ci", "societe-ivoirienne-de-palmier.example"]);
    expect(rows.every((x) => x.discoveredVia === "lien")).toBe(true);
  }, 60_000);
});
