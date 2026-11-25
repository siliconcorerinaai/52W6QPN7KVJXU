/**
 * Test de bout en bout du pipeline en mode démo, sur une base PGlite en mémoire :
 * découverte → qualification → décideurs → emails → rédaction → approbation → envoi → relance.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

beforeAll(() => {
  process.env.DEMO_MODE = "true";
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("pipeline (mode démo)", () => {
  it("prospecte, rédige puis envoie avec relances et arrêt sur réponse", async () => {
    const { intelligence } = await import("@/lib/ai");
    const { createCampaign, getCampaign, campaignStats, approveContacts, setContactStatus, listLeads } = await import("@/lib/pipeline/campaigns");
    const { tick } = await import("@/lib/jobs/worker");
    const { getDb } = await import("@/lib/db");
    const { messages } = await import("@/lib/db/schema");

    const prompt = "Agences web en France qui vendent des sites Shopify";
    const { campaignName, ...plan } = await intelligence().plan({ prompt, offer: {} as never }, {});
    expect(campaignName).toBeTruthy();

    const c = await createCampaign({ userId: null, prompt, plan, offer: { senderName: "Camille" }, settings: { targetCompanies: 4, contactsPerCompany: 1 } });

    for (let i = 0; i < 120; i++) {
      await tick({ concurrency: 6, deadlineMs: 5000 });
      if ((await getCampaign(c.id))?.status === "completed") break;
      await sleep(400);
    }
    const done = await getCampaign(c.id);
    expect(done?.status).toBe("completed");

    const stats = (await campaignStats([c.id]))[c.id];
    expect(stats.qualified).toBeGreaterThanOrEqual(4);
    expect(stats.contacts).toBeGreaterThanOrEqual(4);
    expect(stats.drafted).toBeGreaterThan(0);

    const leads = await listLeads(c.id);
    const drafted = leads.filter((l) => l.contact.status === "drafted").map((l) => l.contact.id);
    expect(drafted.length).toBeGreaterThan(0);

    const scheduled = await approveContacts(drafted);
    expect(scheduled).toBe(drafted.length);

    // Le premier prospect contacté répond : ses relances doivent être annulées
    let responder: string | undefined;
    for (let i = 0; i < 40 && !responder; i++) {
      await tick({ concurrency: 4, deadlineMs: 3000 });
      const db = await getDb();
      const sent = await db.select().from(messages).where(eq(messages.status, "sent"));
      responder = sent.find((m) => m.step === 1 && drafted.includes(m.contactId))?.contactId;
      if (!responder) await sleep(500);
    }
    expect(responder).toBeDefined();
    await setContactStatus(responder!, "replied");

    const db = await getDb();
    const responderMsgs = await db.select().from(messages).where(eq(messages.contactId, responder!));
    expect(responderMsgs.find((m) => m.step === 1)?.status).toBe("sent");
    expect(responderMsgs.filter((m) => m.step > 1).every((m) => m.status === "cancelled")).toBe(true);

    const after = (await campaignStats([c.id]))[c.id];
    expect(after.sent).toBeGreaterThan(0);
    expect(after.replied).toBe(1);
  });
});

describe("garde-fous du plan", () => {
  it("refuse de lancer une campagne dont le plan est vide (cible non B2B)", async () => {
    const { createCampaign } = await import("@/lib/pipeline/campaigns");
    const emptyPlan = {
      summary: "Plan non réalisable",
      industries: [],
      geographies: ["France"],
      companySize: "",
      keywords: [],
      personas: [],
      signals: [],
      exclusions: [],
      searchQueries: [],
      qualificationCriteria: [],
    };
    await expect(createCampaign({ userId: null, prompt: "particuliers en détresse", plan: emptyPlan, offer: {}, settings: {} })).rejects.toThrow(/plan de ciblage est vide/);
  });

  it("le plan de démonstration est marqué réalisable", async () => {
    const { intelligence } = await import("@/lib/ai");
    const plan = await intelligence().plan({ prompt: "Agences web à Lyon", offer: {} as never }, {});
    expect(plan.feasible).toBe(true);
    expect(plan.feasibilityIssue).toBeNull();
  });
});
