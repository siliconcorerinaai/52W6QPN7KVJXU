/**
 * Envoi aux adresses sûres : catégories d'adresses, règle d'envoi par campagne,
 * premiers emails mis de côté puis libérés, coupe-circuit sur les rebonds (mode démo, PGlite).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { addressTier, breakerTripped, policyAllows, stricter } from "@/lib/outreach/safety";
import type { EmailStatus, Job } from "@/lib/db/schema";

const A = "camp-safe";
const B = "camp-breaker";

const plan = { summary: "", industries: [], geographies: ["États-Unis"], companySize: "", keywords: [], personas: [], signals: [], exclusions: [], searchQueries: ["x"], qualificationCriteria: [] };
const offer = { senderCompany: "Ciblora Studio", senderName: "Franck", product: "Visuels", valueProposition: "", callToAction: "", bookingUrl: "", tone: "", language: "auto" };
const settings = { targetCompanies: 3, contactsPerCompany: 1, minScore: 50, autoWrite: false, deepResearch: false, sequenceSteps: 1, followUpDays: 3, seedDomains: [], webhookUrl: "" };

type Facts = { emailStatus: EmailStatus; emailConfidence: number; emailSource: string };
const VERIFIED: Facts = { emailStatus: "valid", emailConfidence: 90, emailSource: "published" };
const PROBABLE: Facts = { emailStatus: "risky", emailConfidence: 75, emailSource: "pattern" };
const GUESS: Facts = { emailStatus: "risky", emailConfidence: 45, emailSource: "pattern-guess" };

const job = (messageId: string, force = false) => ({ id: 0, type: "message.send", payload: { messageId, force } }) as unknown as Job;

async function addContact(campaignId: string, id: string, facts: Facts, msg: { status: "approved" | "sent"; contactStatus?: string; sentAt?: Date }) {
  const { getDb } = await import("@/lib/db");
  const { contacts, messages } = await import("@/lib/db/schema");
  const db = await getDb();
  await db.insert(contacts).values({
    id,
    campaignId,
    companyId: `co-${campaignId}`,
    fullName: `Contact ${id}`,
    email: `${id}@bakery.example`,
    ...facts,
    status: (msg.contactStatus ?? (msg.status === "sent" ? "sent" : "approved")) as "approved",
  });
  await db.insert(messages).values({
    id: `${id}-1`,
    campaignId,
    contactId: id,
    step: 1,
    subject: "Un visuel pour vous",
    body: "Bonjour",
    status: msg.status,
    sentAt: msg.sentAt ?? (msg.status === "sent" ? new Date() : null),
    providerId: msg.status === "sent" ? `<${id}@tryciblora.com>` : null,
  });
}

async function messageOf(contactId: string) {
  const { getDb } = await import("@/lib/db");
  const { messages } = await import("@/lib/db/schema");
  const [m] = await (await getDb()).select().from(messages).where(and(eq(messages.contactId, contactId), eq(messages.step, 1)));
  return m;
}

async function campaign(id: string) {
  const { getCampaign } = await import("@/lib/pipeline/campaigns");
  return (await getCampaign(id))!;
}

beforeAll(async () => {
  process.env.DEMO_MODE = "true";
  const { getDb } = await import("@/lib/db");
  const { campaigns, companies } = await import("@/lib/db/schema");
  const db = await getDb();
  for (const id of [A, B]) {
    await db.insert(campaigns).values({ id, name: id, prompt: "test", status: "running", plan, offer, settings });
    await db.insert(companies).values({ id: `co-${id}`, campaignId: id, domain: "bakery.example", name: "Sunny Bakery", country: "États-Unis", language: "en" });
  }
});

describe("fiabilité des adresses", () => {
  it("classe les adresses : vérifiée, format confirmé, devinée", () => {
    const e = { email: "a@b.example" };
    expect(addressTier({ ...e, ...VERIFIED })).toBe("verified");
    expect(addressTier({ ...e, emailStatus: "risky", emailConfidence: 82, emailSource: "hunter" })).toBe("verified");
    expect(addressTier({ ...e, emailStatus: "unknown", emailConfidence: 0, emailSource: "manual" })).toBe("verified");
    expect(addressTier({ ...e, ...PROBABLE })).toBe("probable");
    expect(addressTier({ ...e, emailStatus: "catch_all", emailConfidence: 75, emailSource: "pattern" })).toBe("probable");
    expect(addressTier({ ...e, ...GUESS })).toBe("guess");
    expect(addressTier({ ...e, emailStatus: "invalid", emailConfidence: 75, emailSource: "pattern" })).toBe("unusable");
    // Après un rebond, l'adresse garde sa catégorie d'origine pour le calcul du taux
    expect(addressTier({ ...e, emailStatus: "invalid", emailConfidence: 75, emailSource: "pattern" }, { atSend: true })).toBe("probable");
    expect(addressTier({ email: null, ...VERIFIED })).toBe("unusable");
  });

  it("applique la règle d'envoi", () => {
    expect(policyAllows("safe", "verified")).toBe(true);
    expect(policyAllows("safe", "probable")).toBe(false);
    expect(policyAllows("balanced", "probable")).toBe(true);
    expect(policyAllows("balanced", "guess")).toBe(false);
    expect(policyAllows("all", "guess")).toBe(true);
    expect(policyAllows("all", "unusable")).toBe(false);
    expect(stricter("all")).toBe("balanced");
    expect(stricter("balanced")).toBe("safe");
    expect(stricter("safe")).toBeNull();
  });

  it("ne déclenche le coupe-circuit qu'avec assez d'envois et de rebonds", () => {
    expect(breakerTripped({ attempts: 9, bounces: 3, rate: 3 / 9 })).toBe(false);
    expect(breakerTripped({ attempts: 12, bounces: 1, rate: 1 / 12 })).toBe(false);
    expect(breakerTripped({ attempts: 40, bounces: 2, rate: 0.05 })).toBe(false);
    expect(breakerTripped({ attempts: 20, bounces: 2, rate: 0.1 })).toBe(true);
  });
});

describe("règle d'envoi d'une campagne", () => {
  it("met de côté le premier email vers une adresse devinée (règle « Équilibré » par défaut)", async () => {
    const { runJob } = await import("@/lib/pipeline/handlers");
    await addContact(A, "v1", VERIFIED, { status: "approved" });
    await addContact(A, "p1", PROBABLE, { status: "approved" });
    await addContact(A, "g1", GUESS, { status: "approved" });
    for (const id of ["v1", "p1", "g1"]) await runJob(job(`${id}-1`));

    expect((await messageOf("v1")).status).toBe("sent");
    expect((await messageOf("p1")).status).toBe("sent");
    const held = await messageOf("g1");
    expect(held.status).toBe("held");
    expect(held.error).toMatch(/devinée/);

    const { listLeads } = await import("@/lib/pipeline/campaigns");
    const leads = await listLeads(A);
    expect(leads.find((l) => l.contact.id === "g1")?.held).toBe(true);
    expect(leads.find((l) => l.contact.id === "v1")?.held).toBe(false);

    const { safetyOverview } = await import("@/lib/pipeline/safety");
    const s = await safetyOverview(A);
    expect(s).toMatchObject({ policy: "balanced", held: 1, health: { attempts: 2, bounces: 0 } });
  });

  it("libère les emails mis de côté quand la règle s'assouplit", async () => {
    const { updateCampaignConfig } = await import("@/lib/pipeline/campaigns");
    const { runJob } = await import("@/lib/pipeline/handlers");
    await updateCampaignConfig(A, { settings: { sendPolicy: "all" } });
    const c = await campaign(A);
    expect(c.settings.sendPolicy).toBe("all");
    expect(c.settings.sendPolicySince).toBeTruthy();
    expect(c.settings.targetCompanies).toBe(3);

    const m = await messageOf("g1");
    expect(m.status).toBe("approved");
    const { getDb } = await import("@/lib/db");
    const { jobs } = await import("@/lib/db/schema");
    const [queued] = await (await getDb()).select().from(jobs).where(eq(jobs.type, "message.send")).orderBy(desc(jobs.id)).limit(1);
    expect(queued.payload).toMatchObject({ messageId: "g1-1", force: false });
    await runJob(queued);
    expect((await messageOf("g1")).status).toBe("sent");
  });

  it("« Envoyer quand même » passe outre la règle", async () => {
    const { setSendPolicy, releaseHeld } = await import("@/lib/pipeline/safety");
    const { runJob } = await import("@/lib/pipeline/handlers");
    await setSendPolicy(A, "safe");
    await addContact(A, "p2", PROBABLE, { status: "approved" });
    await runJob(job("p2-1"));
    expect((await messageOf("p2")).status).toBe("held");

    // Sans forcer, la règle « Sûr » le garde de côté
    expect(await releaseHeld(A)).toBe(0);
    expect(await releaseHeld(A, { force: true, contactIds: ["p2"] })).toBe(1);
    const { getDb } = await import("@/lib/db");
    const { jobs } = await import("@/lib/db/schema");
    const [queued] = await (await getDb()).select().from(jobs).where(eq(jobs.type, "message.send")).orderBy(desc(jobs.id)).limit(1);
    expect(queued.payload).toMatchObject({ messageId: "p2-1", force: true });
    await runJob(queued);
    expect((await messageOf("p2")).status).toBe("sent");
  });
});

describe("coupe-circuit sur les rebonds", () => {
  it("resserre la règle d'un cran, puis met la campagne en pause", async () => {
    const { checkBounceBreaker, bounceHealth } = await import("@/lib/pipeline/safety");
    const earlier = new Date(Date.now() - 3_600_000);
    // 12 premiers emails vers des adresses au format confirmé, dont 2 rebonds (17 %)
    for (let i = 0; i < 12; i++) {
      const bounced = i < 2;
      await addContact(B, `b${i}`, bounced ? { ...PROBABLE, emailStatus: "invalid" } : PROBABLE, {
        status: "sent",
        contactStatus: bounced ? "bounced" : "sent",
        sentAt: earlier,
      });
    }
    expect(await bounceHealth(await campaign(B))).toMatchObject({ attempts: 12, bounces: 2 });
    expect(await checkBounceBreaker(B)).toBe(true);
    let c = await campaign(B);
    expect(c.settings.sendPolicy).toBe("safe");
    expect(c.status).toBe("running");
    // Nouvelle fenêtre de mesure : rien à recompter tout de suite
    expect(await checkBounceBreaker(B)).toBe(false);

    // Même avec des adresses vérifiées, les rebonds continuent → pause
    for (let i = 0; i < 10; i++) {
      const bounced = i < 3;
      await addContact(B, `s${i}`, bounced ? { ...VERIFIED, emailStatus: "invalid" } : VERIFIED, {
        status: "sent",
        contactStatus: bounced ? "bounced" : "sent",
      });
    }
    expect(await checkBounceBreaker(B)).toBe(true);
    c = await campaign(B);
    expect(c.status).toBe("paused");

    const { getDb } = await import("@/lib/db");
    const { events } = await import("@/lib/db/schema");
    const logged = await (await getDb()).select().from(events).where(and(eq(events.campaignId, B), eq(events.kind, "safety")));
    expect(logged.map((e) => e.level)).toEqual(["warn", "error"]);
  });

  it("un rebond détecté dans la boîte de réception déclenche le contrôle", async () => {
    const { applyInbound } = await import("@/lib/outreach/inbox");
    const { getDb } = await import("@/lib/db");
    const { campaigns, companies, contacts } = await import("@/lib/db/schema");
    const db = await getDb();
    const C = "camp-inbox-breaker";
    await db.insert(campaigns).values({ id: C, name: C, prompt: "test", status: "running", plan, offer, settings: { ...settings, sendPolicy: "all" } });
    await db.insert(companies).values({ id: `co-${C}`, campaignId: C, domain: "bakery.example", name: "Sunny Bakery", country: "États-Unis", language: "en" });
    for (let i = 0; i < 10; i++) await addContact(C, `ib${i}`, i < 2 ? GUESS : PROBABLE, { status: "sent" });
    await db.update(contacts).set({ status: "bounced", emailStatus: "invalid" }).where(eq(contacts.id, "ib0"));

    // Second rebond, reçu par la boîte : 2 sur 10 → la règle « Tout » passe à « Équilibré »
    await applyInbound(
      [{ uid: 1, from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", body: "Final-Recipient: rfc822;ib1@bakery.example\r\nStatus: 5.1.1" }],
      ["franck@tryciblora.com"],
    );
    const c = await campaign(C);
    expect(c.settings.sendPolicy).toBe("balanced");
  });
});
