/**
 * Visuel offert aux prospects : consigne, compression, génération unique par entreprise,
 * lien dans le premier email et page publique (mode démo, base PGlite en mémoire).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { visualPrompt } from "@/lib/visual-prompt";
import { compressImage, withSampleLink } from "@/lib/visuals";
import { decodeDataUrl } from "@/lib/ai/openrouter";

beforeAll(() => {
  process.env.DEMO_MODE = "true";
});

describe("visuel offert : briques", () => {
  it("rédige une consigne d'image à l'image de l'entreprise", () => {
    const p = visualPrompt(
      { name: "Boulangerie Dupain", industry: "Boulangerie artisanale", location: "Lyon", country: "France", description: "Pains au levain et viennoiseries.", language: "fr" },
      "affiche pour la galette des rois",
    );
    expect(p).toContain('"Boulangerie Dupain"');
    expect(p).toContain("Lyon, France");
    expect(p).toContain("galette des rois");
    expect(p).toContain("tagline in French");
    expect(p).toMatch(/No prices, phone numbers/);
  });

  it("place le lien après le premier paragraphe, sans doublon", () => {
    const url = "https://tryciblora.com/v/abc123def456";
    const body = "Bonjour Marie,\n\nJ'ai vu votre nouvelle carte.\n\nBien à vous,\nFranck";
    const out = withSampleLink(body, url);
    expect(out.split("\n\n")[1]).toBe(url);
    expect(withSampleLink(out, url)).toBe(out);
  });

  it("décode l'image renvoyée par le modèle", () => {
    const img = decodeDataUrl(`data:image/png;base64,${Buffer.from("png!").toString("base64")}`);
    expect(img?.mime).toBe("image/png");
    expect(img?.data.toString()).toBe("png!");
    expect(decodeDataUrl("https://exemple.com/image.png")).toBeNull();
  });

  it("réduit les grandes images en JPEG de 1080 px", async () => {
    const png = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: { r: 220, g: 80, b: 40 } } }).png().toBuffer();
    const out = await compressImage(png, "image/png");
    expect(out.mime).toBe("image/jpeg");
    const meta = await sharp(out.data).metadata();
    expect(meta.width).toBe(1080);
    expect(out.data.length).toBeLessThan(png.length);
    // Les SVG (mode démo) sont gardés tels quels.
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect((await compressImage(svg, "image/svg+xml")).data).toBe(svg);
  });
});

describe("visuel offert dans une campagne (mode démo)", () => {
  it("crée un visuel par entreprise qualifiée, le cite dans le premier email et le sert publiquement", async () => {
    const { intelligence } = await import("@/lib/ai");
    const { createCampaign, getCampaign } = await import("@/lib/pipeline/campaigns");
    const { tick } = await import("@/lib/jobs/worker");
    const { getDb } = await import("@/lib/db");
    const { companies, contacts, messages, samples } = await import("@/lib/db/schema");
    const { ensureSample } = await import("@/lib/visuals");

    const prompt = "Boulangeries artisanales à Lyon";
    const { campaignName, feasible, feasibilityIssue, ...plan } = await intelligence().plan({ prompt, offer: {} as never }, {});
    const c = await createCampaign({
      userId: null,
      prompt,
      plan,
      offer: { senderName: "Franck", senderCompany: "Studio Lumière" },
      settings: {
        targetCompanies: 2,
        contactsPerCompany: 1,
        minScore: 0,
        importOnly: true,
        importedCompanies: [
          { name: "Boulangerie Dupain", domain: "dupain.example" },
          { name: "Fournil des Halles", domain: "fournil-halles.example" },
        ],
        visualSample: true,
        visualBrief: "affiche pour les réseaux sociaux",
      },
    });

    for (let i = 0; i < 80; i++) {
      await tick({ concurrency: 6, deadlineMs: 4000 });
      if ((await getCampaign(c.id))?.status === "completed") break;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect((await getCampaign(c.id))?.status).toBe("completed");

    const db = await getDb();
    const rows = await db.select().from(samples).where(eq(samples.campaignId, c.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "ready" && r.data && r.mime === "image/svg+xml")).toBe(true);

    // Le premier email de chaque lead contient le lien de son visuel.
    const leads = await db.select().from(contacts).where(eq(contacts.campaignId, c.id));
    const firsts = await db.select().from(messages).where(eq(messages.campaignId, c.id));
    for (const ct of leads.filter((x) => x.status === "drafted")) {
      const sample = rows.find((r) => r.companyId === ct.companyId)!;
      const first = firsts.find((m) => m.contactId === ct.id && m.step === 1)!;
      expect(first.body).toContain(`/v/${sample.id}`);
    }
    expect(leads.some((x) => x.status === "drafted")).toBe(true);

    // Un seul visuel par entreprise, même demandé plusieurs fois en même temps.
    const [co] = await db.select().from(companies).where(eq(companies.id, rows[0].companyId));
    const again = await Promise.all([ensureSample(c, co), ensureSample(c, co)]);
    expect(again.map((x) => x?.id)).toEqual([rows[0].id, rows[0].id]);

    // Un échec ancien (ex. crédits épuisés puis rechargés) est retenté ; un échec récent ne l'est pas.
    await db.update(samples).set({ status: "failed", data: null, updatedAt: new Date() }).where(eq(samples.id, rows[0].id));
    expect(await ensureSample(c, co)).toBeNull();
    await db.update(samples).set({ updatedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(samples.id, rows[0].id));
    const retried = await ensureSample(c, co);
    expect(retried?.id).toBe(rows[0].id);
    expect(retried?.status).toBe("ready");

    // L'image est servie publiquement, sans possibilité d'exécuter un script.
    const { GET } = await import("@/app/v/[id]/image/route");
    const res = await GET(new Request("http://localhost/"), { params: Promise.resolve({ id: rows[0].id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(await res.text()).toContain("<svg");
    const missing = await GET(new Request("http://localhost/"), { params: Promise.resolve({ id: "inexistant-1234567" }) });
    expect(missing.status).toBe(404);

  }, 60_000);
});
