/**
 * Assistant Facebook et publicité ciblée : repérage des pages, messages préparés, suivi des envois,
 * réponse (qui arrête les emails), audience au format Meta et textes d'annonce (mode démo, PGlite).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { facebookPageFrom, instagramFrom, messengerUrl, normalizeFacebookUrl } from "@/lib/social";
import { isoCountry } from "@/lib/countries";
import type { Owner } from "@/lib/ownership";

const C = "camp-fb";
const owner: Owner = { id: "user-fb", role: "user" };
const stranger: Owner = { id: "user-autre", role: "user" };

async function runQueued(type: string) {
  const { getDb } = await import("@/lib/db");
  const { jobs } = await import("@/lib/db/schema");
  const { runJob } = await import("@/lib/pipeline/handlers");
  const db = await getDb();
  const queued = await db.select().from(jobs).where(and(eq(jobs.type, type), eq(jobs.status, "queued")));
  for (const j of queued) {
    await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, j.id));
    await runJob(j);
    await db.update(jobs).set({ status: "done" }).where(and(eq(jobs.id, j.id), eq(jobs.status, "running")));
  }
  return queued.length;
}

beforeAll(async () => {
  process.env.DEMO_MODE = "true";
  const { getDb } = await import("@/lib/db");
  const { campaigns, companies, contacts, messages, samples, suppressions, users } = await import("@/lib/db/schema");
  const db = await getDb();
  await db.insert(users).values([
    { id: owner.id, email: "fb@exemple.com", passwordHash: "x" },
    { id: stranger.id, email: "autre@exemple.com", passwordHash: "x" },
  ]);
  await db.insert(campaigns).values({
    id: C,
    userId: owner.id,
    name: "Boulangeries Austin",
    prompt: "test",
    status: "running",
    plan: { summary: "Boulangeries indépendantes d'Austin", industries: ["Boulangerie"], geographies: ["United States"], companySize: "", keywords: [], personas: [], signals: [], exclusions: [], searchQueries: ["x"], qualificationCriteria: [] },
    offer: { senderCompany: "Ciblora Studio", senderName: "Franck Hugues", product: "Visuels promo IA", valueProposition: "des visuels qui donnent faim", callToAction: "un échange", bookingUrl: "", tone: "", language: "auto" },
    settings: { targetCompanies: 3, contactsPerCompany: 1, minScore: 50, autoWrite: false, deepResearch: false, sequenceSteps: 2, followUpDays: 3, seedDomains: [], webhookUrl: "", visualSample: true },
  });
  await db.insert(companies).values([
    { id: "fb-a", campaignId: C, domain: "sunnybakery.example", name: "Sunny Bakery", status: "qualified", score: 80, location: "Austin, Texas", country: "United States", facebookUrl: "https://www.facebook.com/sunnybakeryatx" },
    { id: "fb-b", campaignId: C, domain: "rosiespies.example", name: "Rosie's Pies", status: "qualified", score: 70, location: "Austin", country: "États-Unis" },
    { id: "fb-c", campaignId: C, domain: "nope.example", name: "Hors cible", status: "disqualified", score: 20 },
  ]);
  await db.insert(samples).values({ id: "smp-fb-a-000001", campaignId: C, companyId: "fb-a", status: "ready", mime: "image/jpeg", data: Buffer.from("x") });
  await db.insert(contacts).values([
    { id: "ct-a", campaignId: C, companyId: "fb-a", fullName: "Anna Baker", firstName: "Anna", lastName: "Baker", email: "anna@sunnybakery.example", emailStatus: "valid", status: "sent" },
    { id: "ct-b", campaignId: C, companyId: "fb-b", fullName: "Rosie Lane", email: "rosie@rosiespies.example", emailStatus: "risky", status: "approved" },
    { id: "ct-x", campaignId: C, companyId: "fb-b", fullName: "Out Person", email: "out@rosiespies.example", emailStatus: "valid", status: "unsubscribed" },
    { id: "ct-y", campaignId: C, companyId: "fb-b", fullName: "Excluded Person", email: "excluded@rosiespies.example", emailStatus: "valid", status: "sent" },
  ]);
  await db.insert(messages).values([
    { id: "ct-a-1", campaignId: C, contactId: "ct-a", step: 1, subject: "s", body: "b", status: "sent", sentAt: new Date() },
    { id: "ct-a-2", campaignId: C, contactId: "ct-a", step: 2, subject: "s", body: "b", status: "scheduled", scheduledAt: new Date(Date.now() + 86_400_000) },
  ]);
  await db.insert(suppressions).values({ userId: owner.id, value: "excluded@rosiespies.example" });
});

describe("pages Facebook", () => {
  it("reconnaît les pages et écarte les liens de partage", () => {
    expect(normalizeFacebookUrl("https://www.facebook.com/sunnybakeryatx/")).toBe("https://www.facebook.com/sunnybakeryatx");
    expect(normalizeFacebookUrl("m.facebook.com/RosiesPies?ref=bookmarks")).toBe("https://www.facebook.com/RosiesPies");
    expect(normalizeFacebookUrl("https://facebook.com/profile.php?id=100063512345678")).toBe("https://www.facebook.com/profile.php?id=100063512345678");
    expect(normalizeFacebookUrl("https://www.facebook.com/pages/Rosies-Pies/123456789")).toBe("https://www.facebook.com/123456789");
    expect(normalizeFacebookUrl("https://www.facebook.com/p/Sunny-Bakery-100089876543210/")).toBe("https://www.facebook.com/profile.php?id=100089876543210");
    expect(normalizeFacebookUrl("https://www.facebook.com/sharer/sharer.php?u=x")).toBeNull();
    expect(normalizeFacebookUrl("https://www.facebook.com/groups/austinbakers")).toBeNull();
    expect(normalizeFacebookUrl("https://evil.example/facebook.com/page")).toBeNull();
    expect(facebookPageFrom(["https://twitter.com/x", "https://www.facebook.com/sharer.php", "https://www.facebook.com/SunnyATX"])).toBe("https://www.facebook.com/SunnyATX");
    expect(instagramFrom(["https://www.instagram.com/p/abc", "https://instagram.com/sunny.atx/"])).toBe("https://www.instagram.com/sunny.atx");
    expect(messengerUrl("https://www.facebook.com/SunnyATX")).toBe("https://m.me/SunnyATX");
    expect(messengerUrl("https://www.facebook.com/profile.php?id=100063512345678")).toBe("https://m.me/100063512345678");
  });

  it("donne le code pays attendu par Meta", () => {
    expect(isoCountry("United States")).toBe("US");
    expect(isoCountry("États-Unis")).toBe("US");
    expect(isoCountry("Côte d'Ivoire")).toBe("CI");
    expect(isoCountry("Niger")).toBe("NE");
    expect(isoCountry("Nigeria")).toBe("NG");
    expect(isoCountry("fr")).toBe("FR");
    expect(isoCountry("Atlantide")).toBeNull();
  });
});

describe("assistant Facebook", () => {
  it("cherche les pages manquantes et prépare les messages", async () => {
    const { prepareFacebook, facebookBoard } = await import("@/lib/pipeline/social");
    expect(await prepareFacebook(C)).toEqual({ searching: 1, writing: 1 });
    expect(await runQueued("company.socials")).toBe(1); // Rosie's : page trouvée (démo) → message à rédiger
    expect(await runQueued("social.write")).toBe(2);

    const board = await facebookBoard(C, owner);
    expect(board.rows.map((r) => r.name)).toEqual(["Sunny Bakery", "Rosie's Pies"]); // qualifiées seulement
    const sunny = board.rows[0];
    expect(sunny.messengerUrl).toBe("https://m.me/sunnybakeryatx");
    expect(sunny.social?.status).toBe("todo");
    // Le message cite le visuel offert et l'email déjà envoyé
    expect(sunny.social?.message).toContain("/v/smp-fb-a-000001");
    expect(sunny.social?.message).toMatch(/email/);
    expect(board.rows[1].facebookUrl).toBeTruthy();
    expect(board.stats).toMatchObject({ companies: 2, withPage: 2, toSearch: 0, toPrepare: 0, todo: 2, sent: 0, sentToday: 0 });
    // Rien de plus à lancer
    expect(await prepareFacebook(C)).toEqual({ searching: 0, writing: 0 });
  });

  it("suit l'envoi à la main, et une réponse arrête les emails de l'entreprise", async () => {
    const { facebookBoard, updateSocialMessage } = await import("@/lib/pipeline/social");
    const { getDb } = await import("@/lib/db");
    const { contacts, messages } = await import("@/lib/db/schema");
    const id = (await facebookBoard(C, owner)).rows[0].social!.id;

    // Un autre compte n'y a pas accès
    await expect(updateSocialMessage(id, stranger, { status: "sent" })).rejects.toThrow(/introuvable/);

    await updateSocialMessage(id, owner, { message: "Bonjour Anna, petit message modifié à la main." });
    const sent = await updateSocialMessage(id, owner, { status: "sent" });
    expect(sent.sentAt).toBeTruthy();
    expect((await facebookBoard(C, owner)).stats).toMatchObject({ sent: 1, sentToday: 1 });

    await updateSocialMessage(id, owner, { status: "replied" });
    const db = await getDb();
    const [anna] = await db.select().from(contacts).where(eq(contacts.id, "ct-a"));
    expect(anna.status).toBe("replied");
    const [followUp] = await db.select().from(messages).where(eq(messages.id, "ct-a-2"));
    expect(followUp.status).toBe("cancelled");
    // Un message déjà parti n'est pas réécrit
    const { writeSocialMessage } = await import("@/lib/pipeline/social");
    await writeSocialMessage("fb-a");
    expect((await facebookBoard(C, owner)).rows[0].social?.message).toBe("Bonjour Anna, petit message modifié à la main.");
  });

  it("accepte un lien de page saisi à la main, refuse le reste", async () => {
    const { setFacebookUrl } = await import("@/lib/pipeline/social");
    await expect(setFacebookUrl(C, "fb-b", "https://www.google.com/rosies")).rejects.toThrow(/page Facebook/);
    expect(await setFacebookUrl(C, "fb-b", "facebook.com/RosiesPiesATX")).toBe("https://www.facebook.com/RosiesPiesATX");
    await expect(setFacebookUrl("autre-campagne", "fb-b", "facebook.com/RosiesPiesATX")).rejects.toThrow(/introuvable/);
  });
});

describe("publicité ciblée", () => {
  it("exporte l'audience au format Meta, sans désinscrits ni exclus", async () => {
    const { audienceRows, audienceCsv } = await import("@/lib/pipeline/ads");
    const rows = await audienceRows(owner, C);
    expect(rows.map((r) => r.email).sort()).toEqual(["anna@sunnybakery.example", "rosie@rosiespies.example"]);
    expect(rows.find((r) => r.email.startsWith("anna"))).toEqual({ email: "anna@sunnybakery.example", fn: "Anna", ln: "Baker", ct: "Austin", country: "US" });
    const csv = audienceCsv(rows);
    expect(csv.split("\n")[0]).toBe("email,fn,ln,ct,country");
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    // Toutes les campagnes du compte, mais pas celles d'un autre compte
    expect((await audienceRows(owner, null)).length).toBe(2);
    expect(await audienceRows(stranger, null)).toEqual([]);
  });

  it("rédige et garde les textes d'annonce", async () => {
    const { generateAdCopy, savedAdCopy } = await import("@/lib/pipeline/ads");
    expect(await savedAdCopy(C)).toBeNull();
    const copy = await generateAdCopy(C);
    expect(copy.primaryTexts.length).toBeGreaterThan(0);
    expect(await savedAdCopy(C)).toEqual(copy);
  });
});
