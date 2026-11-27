/**
 * Boîte de réception IA : lecture des réponses, classement, brouillon, envoi dans le fil,
 * désinscription et reprise des relances (mode démo, base PGlite en mémoire).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { cleanReplyText, parseReply } from "@/lib/outreach/reply-text";
import { PLATFORM } from "@/lib/ownership";

const C = "camp-rep";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

beforeAll(async () => {
  process.env.DEMO_MODE = "true";
  const { getDb } = await import("@/lib/db");
  const { campaigns, companies, contacts, messages } = await import("@/lib/db/schema");
  const db = await getDb();
  await db.insert(campaigns).values({
    id: C,
    name: "Boulangeries Austin",
    prompt: "test",
    status: "completed",
    plan: { summary: "", industries: [], geographies: ["États-Unis"], companySize: "", keywords: [], personas: [], signals: [], exclusions: [], searchQueries: ["x"], qualificationCriteria: [] },
    offer: { senderCompany: "Ciblora Studio", senderName: "Franck Hugues", product: "Visuels IA", valueProposition: "", callToAction: "", bookingUrl: "", tone: "", language: "auto", pricing: "5 visuels 149 $" },
    settings: { targetCompanies: 3, contactsPerCompany: 1, minScore: 50, autoWrite: false, deepResearch: false, sequenceSteps: 3, followUpDays: 3, seedDomains: [], webhookUrl: "" },
  });
  await db.insert(companies).values({ id: "co-rep", campaignId: C, domain: "bakery.example", name: "Sunny Bakery", country: "États-Unis", language: "en" });
  for (const [id, name, email] of [
    ["r1", "Anna Baker", "anna@bakery.example"],
    ["r2", "Bob Stop", "bob@bakery.example"],
    ["r3", "Carl Away", "carl@bakery.example"],
    ["r4", "Julian Oops", "julian@bakery.example"],
  ]) {
    await db.insert(contacts).values({ id, campaignId: C, companyId: "co-rep", fullName: name, email, emailStatus: "valid", status: "sent" });
    // Séquence : email 1 envoyé, relances 2 et 3 planifiée / approuvée
    await db.insert(messages).values([
      { id: `${id}-1`, campaignId: C, contactId: id, step: 1, subject: "a visual for Sunny", body: "Hi", status: "sent", sentAt: daysAgo(1), providerId: `<${id}-1@tryciblora.com>`, mailboxId: "demo" },
      { id: `${id}-2`, campaignId: C, contactId: id, step: 2, delayDays: 3, subject: "s2", body: "b2", status: "scheduled", scheduledAt: daysAgo(-2) },
      { id: `${id}-3`, campaignId: C, contactId: id, step: 3, delayDays: 3, subject: "s3", body: "b3", status: "approved" },
    ]);
  }
});

const mime = (opts: { from: string; subject: string; messageId: string; inReplyTo?: string; text: string }) =>
  [
    `From: ${opts.from}`,
    `To: Franck Hugues <franck@tryciblora.com>`,
    `Subject: ${opts.subject}`,
    `Message-ID: ${opts.messageId}`,
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : "",
    `Date: Thu, 26 Nov 2026 18:02:11 +0000`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    opts.text,
  ]
    .filter((l, i) => l !== "" || i > 5)
    .join("\r\n");

describe("lecture des réponses", () => {
  it("ne garde que ce que le prospect a écrit", () => {
    expect(cleanReplyText("Yes please, how much for 5?\n\nOn Thu, Nov 26, 2026 at 10:15 AM Franck Hugues <franck@tryciblora.com>\nwrote:\n> Hi Anna,\n> I made a visual")).toBe(
      "Yes please, how much for 5?",
    );
    expect(cleanReplyText("Oui, on en parle mardi.\n\nLe jeu. 26 nov. 2026 à 10:15, Franck Hugues <franck@tryciblora.com> a écrit :\n> Bonjour")).toBe(
      "Oui, on en parle mardi.",
    );
    expect(cleanReplyText("Sounds good\r\n\r\nFrom: Franck Hugues\r\nSent: Thursday\r\nTo: Anna")).toBe("Sounds good");
    expect(cleanReplyText("Thanks\n> quoted line\nBest,\nAnna")).toBe("Thanks\nBest,\nAnna");
  });

  it("décode un message MIME (quoted-printable) et retire l'historique", async () => {
    const p = await parseReply(
      mime({
        from: "Anna Baker <anna@bakery.example>",
        subject: "Re: a visual for Sunny",
        messageId: "<ans-1@mail.example>",
        inReplyTo: "<r1-1@tryciblora.com>",
        text: "Love it! How much for 5 visuals? We'd like them before the holid=\r\nays.\r\n\r\nOn Thu, Nov 26, 2026 at 10:15 AM Franck Hugues wrote:\r\n> Hi Anna",
      }),
    );
    expect(p.text).toBe("Love it! How much for 5 visuals? We'd like them before the holidays.");
    expect(p.messageId).toBe("<ans-1@mail.example>");
    expect(p.inReplyTo).toBe("<r1-1@tryciblora.com>");
    expect(p.fromName).toBe("Anna Baker");
  });
});

describe("boîte de réception IA (mode démo)", () => {
  it("enregistre la réponse une seule fois, la classe et prépare un brouillon", async () => {
    const { getDb } = await import("@/lib/db");
    const { contacts, jobs, messages, replies } = await import("@/lib/db/schema");
    const { applyInbound, newProspectReplies } = await import("@/lib/outreach/inbox");
    const { triageReply, listReplies, countNewReplies } = await import("@/lib/pipeline/replies");
    const db = await getDb();

    const item = {
      uid: 11,
      from: "anna@bakery.example",
      subject: "Re: a visual for Sunny",
      inReplyTo: "<r1-1@tryciblora.com>",
      messageId: "<ans-1@mail.example>",
      body: mime({ from: "Anna Baker <anna@bakery.example>", subject: "Re: a visual for Sunny", messageId: "<ans-1@mail.example>", inReplyTo: "<r1-1@tryciblora.com>", text: "Love it! How much for 5 visuals?" }),
    };
    // Seules les réponses de prospects connus, pas encore enregistrées, sont téléchargées
    const stranger = { uid: 12, from: "news@random.example", subject: "Newsletter", messageId: "<n@x>" };
    expect([...(await newProspectReplies([item, stranger], ["franck@tryciblora.com"]))]).toEqual([11]);

    expect(await applyInbound([item], ["franck@tryciblora.com"], PLATFORM)).toEqual({ replies: 1, bounces: 0 });
    expect(await applyInbound([item], ["franck@tryciblora.com"], PLATFORM)).toEqual({ replies: 0, bounces: 0 });
    const stored = await db.select().from(replies).where(eq(replies.contactId, "r1"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ direction: "in", body: "Love it! How much for 5 visuals?", status: "new", category: null });
    expect(await newProspectReplies([item], ["franck@tryciblora.com"])).toEqual(new Set());
    const queued = await db.select().from(jobs).where(eq(jobs.type, "reply.triage"));
    expect(queued.map((j) => j.payload.replyId)).toContain(stored[0].id);

    // Relances arrêtées, contact « a répondu »
    const [anna] = await db.select().from(contacts).where(eq(contacts.id, "r1"));
    expect(anna.status).toBe("replied");
    const [f2] = await db.select().from(messages).where(eq(messages.id, "r1-2"));
    expect(f2.status).toBe("cancelled");

    await triageReply(stored[0].id);
    const [triaged] = await db.select().from(replies).where(eq(replies.id, stored[0].id));
    expect(triaged.category).toBe("question");
    expect(triaged.draftBody).toContain("149 $");
    expect(triaged.status).toBe("new");

    const todo = await listReplies(PLATFORM, "todo");
    expect(todo.map((r) => r.contactName)).toEqual(["Anna Baker"]);
    expect(await countNewReplies(PLATFORM)).toBe(1);
    expect(await listReplies({ id: "someone-else", role: "user" }, "all")).toEqual([]);
  });

  it("envoie la réponse dans le fil, puis rattache la suite de la conversation", async () => {
    const { getDb } = await import("@/lib/db");
    const { replies } = await import("@/lib/db/schema");
    const { applyInbound } = await import("@/lib/outreach/inbox");
    const { sendReply, getReplyDetail, countNewReplies } = await import("@/lib/pipeline/replies");
    const db = await getDb();
    const [inbound] = await db.select().from(replies).where(and(eq(replies.contactId, "r1"), eq(replies.direction, "in")));

    await sendReply(inbound.id, PLATFORM, { subject: "Re: a visual for Sunny", body: "Hi Anna, 5 visuals are 149 $." });
    const detail = await getReplyDetail(inbound.id, PLATFORM);
    expect(detail.reply.status).toBe("answered");
    expect(detail.thread.map((t) => t.from)).toEqual(["us", "prospect", "us"]);
    expect(await countNewReplies(PLATFORM)).toBe(0);
    const out = detail.thread.at(-1)!;
    const [outRow] = await db.select().from(replies).where(eq(replies.id, out.id));

    // Anna répond à notre réponse : même contact, nouvelle entrée dans le fil
    await applyInbound(
      [{ uid: 13, from: "anna@bakery.example", subject: "Re: a visual for Sunny", inReplyTo: outRow.messageId, messageId: "<ans-2@mail.example>", body: mime({ from: "anna@bakery.example", subject: "Re: a visual for Sunny", messageId: "<ans-2@mail.example>", inReplyTo: outRow.messageId!, text: "Perfect, yes let's do it." }) }],
      ["franck@tryciblora.com"],
      PLATFORM,
    );
    const thread = (await getReplyDetail(inbound.id, PLATFORM)).thread;
    expect(thread).toHaveLength(4);
    expect(thread.filter((t) => t.from === "prospect").map((t) => t.body)).toContain("Perfect, yes let's do it.");
  });

  it("désinscrit sur demande et reprend les relances après une réponse automatique", async () => {
    const { getDb } = await import("@/lib/db");
    const { contacts, messages, replies, suppressions } = await import("@/lib/db/schema");
    const { applyInbound } = await import("@/lib/outreach/inbox");
    const { triageReply } = await import("@/lib/pipeline/replies");
    const db = await getDb();
    const own = ["franck@tryciblora.com"];

    await applyInbound(
      [
        { uid: 21, from: "bob@bakery.example", subject: "Re: a visual", messageId: "<bob@x>", body: mime({ from: "bob@bakery.example", subject: "Re: a visual", messageId: "<bob@x>", text: "Please remove me from your list." }) },
        // Absence sans en-tête « Auto-Submitted » : seule l'IA la reconnaît
        { uid: 22, from: "carl@bakery.example", subject: "Re: a visual", messageId: "<carl@x>", body: mime({ from: "carl@bakery.example", subject: "Re: a visual", messageId: "<carl@x>", text: "I am out of office until Monday." }) },
      ],
      own,
      PLATFORM,
    );
    for (const r of await db.select().from(replies).where(eq(replies.direction, "in"))) if (!r.category) await triageReply(r.id);

    const [bob] = await db.select().from(contacts).where(eq(contacts.id, "r2"));
    expect(bob.status).toBe("unsubscribed");
    expect((await db.select().from(suppressions)).map((s) => s.value)).toContain("bob@bakery.example");

    const [carl] = await db.select().from(contacts).where(eq(contacts.id, "r3"));
    expect(carl.status).toBe("sent");
    const carlMsgs = Object.fromEntries((await db.select().from(messages).where(eq(messages.contactId, "r3"))).map((m) => [m.step, m.status]));
    expect(carlMsgs).toEqual({ 1: "sent", 2: "scheduled", 3: "approved" });
    const [carlReply] = await db.select().from(replies).where(eq(replies.contactId, "r3"));
    expect(carlReply).toMatchObject({ category: "auto", status: "handled", draftBody: null });
  });

  it("reprend les relances d'un contact marqué « a répondu » par erreur", async () => {
    const { getDb } = await import("@/lib/db");
    const { contacts, messages } = await import("@/lib/db/schema");
    const { setContactStatus } = await import("@/lib/pipeline/campaigns");
    const { resumeFollowUps } = await import("@/lib/pipeline/replies");
    const db = await getDb();

    await setContactStatus("r4", "replied");
    expect(Object.values(Object.fromEntries((await db.select().from(messages).where(eq(messages.contactId, "r4"))).map((m) => [m.step, m.status])))).toEqual([
      "sent",
      "cancelled",
      "cancelled",
    ]);
    expect(await resumeFollowUps("r4")).toBe(2);
    const [julian] = await db.select().from(contacts).where(eq(contacts.id, "r4"));
    expect(julian.status).toBe("sent");
    const steps = Object.fromEntries((await db.select().from(messages).where(eq(messages.contactId, "r4"))).map((m) => [m.step, m.status]));
    expect(steps).toEqual({ 1: "sent", 2: "scheduled", 3: "approved" });
    await expect(resumeFollowUps("r4")).rejects.toThrow(/a répondu/);
  });
});
