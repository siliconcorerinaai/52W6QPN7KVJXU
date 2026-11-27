/**
 * Un envoi reporté (hors créneau, limite du jour, adresse postale manquante…) ne doit jamais être perdu :
 * le worker ne referme pas un job que son handler a remis en file, et les envois approuvés
 * restés sans job sont remis en file.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

const C = "camp-resched";

beforeAll(async () => {
  process.env.DEMO_MODE = "true";
  const { getDb } = await import("@/lib/db");
  const { campaigns, companies, contacts, messages } = await import("@/lib/db/schema");
  const db = await getDb();
  await db.insert(campaigns).values({
    id: C,
    name: C,
    prompt: "test",
    status: "completed",
    plan: { summary: "", industries: [], geographies: ["États-Unis"], companySize: "", keywords: [], personas: [], signals: [], exclusions: [], searchQueries: ["x"], qualificationCriteria: [] },
    offer: { senderCompany: "S", senderName: "F", product: "P", valueProposition: "", callToAction: "", bookingUrl: "", tone: "", language: "auto" },
    settings: { targetCompanies: 3, contactsPerCompany: 1, minScore: 50, autoWrite: false, deepResearch: false, sequenceSteps: 2, followUpDays: 3, seedDomains: [], webhookUrl: "" },
  });
  await db.insert(companies).values({ id: "co-resched", campaignId: C, domain: "bakery.example", name: "Sunny Bakery" });
  const old = new Date(Date.now() - 86_400_000);
  // Premier email approuvé dont le job a été refermé par erreur
  await db.insert(contacts).values({ id: "o1", campaignId: C, companyId: "co-resched", fullName: "Irene", email: "irene@bakery.example", emailStatus: "valid", status: "approved" });
  await db.insert(messages).values([
    { id: "o1-1", campaignId: C, contactId: "o1", step: 1, subject: "s", body: "b", status: "approved", scheduledAt: old, updatedAt: old },
    { id: "o1-2", campaignId: C, contactId: "o1", step: 2, subject: "s", body: "b", status: "approved", updatedAt: old },
  ]);
  // Relance planifiée sans job, et contact qui a répondu (à ne pas relancer)
  await db.insert(contacts).values({ id: "o2", campaignId: C, companyId: "co-resched", fullName: "Noah", email: "noah@bakery.example", emailStatus: "valid", status: "sent" });
  await db.insert(contacts).values({ id: "o3", campaignId: C, companyId: "co-resched", fullName: "Ryan", email: "ryan@bakery.example", emailStatus: "valid", status: "replied" });
  const later = new Date(Date.now() + 2 * 86_400_000);
  await db.insert(messages).values([
    { id: "o2-2", campaignId: C, contactId: "o2", step: 2, subject: "s", body: "b", status: "scheduled", scheduledAt: later, updatedAt: old },
    { id: "o3-2", campaignId: C, contactId: "o3", step: 2, subject: "s", body: "b", status: "scheduled", scheduledAt: later, updatedAt: old },
  ]);
  await db.execute(sql`INSERT INTO prospecta.jobs (type, payload, campaign_id, status) VALUES ('message.send', '{"messageId":"o1-1"}', ${C}, 'done')`);
});

describe("envois reportés", () => {
  it("un job reporté par son handler reste en file après sa clôture", async () => {
    const { enqueue, claimJob, rescheduleJob, completeJob } = await import("@/lib/jobs/queue");
    const { getDb } = await import("@/lib/db");
    const { jobs } = await import("@/lib/db/schema");
    const db = await getDb();
    const id = await enqueue("mailbox.sync", {}, { priority: 100 });
    const job = (await claimJob("w1"))!;
    expect(job.id).toBe(id);
    const tomorrow = new Date(Date.now() + 86_400_000);
    await rescheduleJob(job, tomorrow);
    await completeJob(job.id);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(row.status).toBe("queued");
    expect(row.runAt.getTime()).toBe(tomorrow.getTime());

    // Un job exécuté normalement est bien refermé
    const id2 = await enqueue("mailbox.sync", {}, { priority: 100 });
    await claimJob("w1");
    await completeJob(id2);
    const [row2] = await db.select().from(jobs).where(eq(jobs.id, id2));
    expect(row2.status).toBe("done");
  });

  it("remet en file les envois approuvés restés sans job", async () => {
    const { requeueOrphanSends } = await import("@/lib/jobs/queue");
    const { getDb } = await import("@/lib/db");
    const { jobs } = await import("@/lib/db/schema");
    expect(await requeueOrphanSends()).toEqual([{ campaignId: C, n: 2 }]);
    const queued = (await (await getDb()).select().from(jobs).where(eq(jobs.status, "queued")))
      .filter((j) => j.type === "message.send")
      .map((j) => j.payload.messageId)
      .sort();
    // Premier email d'Irene et relance de Noah ; pas l'étape 2 d'Irene (elle suit l'email 1), ni Ryan (a répondu)
    expect(queued).toEqual(["o1-1", "o2-2"]);
    // Rien de plus au passage suivant
    expect(await requeueOrphanSends()).toEqual([]);
  });
});
