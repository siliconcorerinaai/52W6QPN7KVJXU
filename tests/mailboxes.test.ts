/** Boîtes d'envoi (rotation, limites, chiffrement) et détection des réponses / rebonds, sur PGlite en mémoire. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PLATFORM } from "@/lib/ownership";

const ids = { campaign: "c1", company: "co1" };

beforeAll(async () => {
  delete process.env.SMTP_HOST;
  process.env.UNSUBSCRIBE_SECRET = "secret-de-test";
  const { getDb } = await import("@/lib/db");
  const { campaigns, companies, contacts } = await import("@/lib/db/schema");
  const db = await getDb();
  await db.insert(campaigns).values({
    id: ids.campaign,
    name: "Test",
    prompt: "test",
    status: "completed",
    plan: { summary: "", industries: [], geographies: [], companySize: "", keywords: [], personas: [], signals: [], exclusions: [], searchQueries: ["x"], qualificationCriteria: [] },
    offer: { senderCompany: "", senderName: "", product: "", valueProposition: "", callToAction: "", bookingUrl: "", tone: "", language: "fr" },
    settings: { targetCompanies: 1, contactsPerCompany: 1, minScore: 50, autoWrite: false, deepResearch: false, sequenceSteps: 2, followUpDays: 3, seedDomains: [], webhookUrl: "" },
  });
  await db.insert(companies).values({ id: ids.company, campaignId: ids.campaign, domain: "acme.fr", name: "Acme" });
  for (const [id, name, email] of [
    ["k1", "Jean Dupont", "jean.dupont@acme.fr"],
    ["k2", "Marie Curie", "marie.curie@acme.fr"],
    ["k3", "Paul Valéry", "paul.valery@acme.fr"],
    ["k4", "Ada Lovelace", "ada@acme.fr"],
  ]) {
    await db.insert(contacts).values({ id, campaignId: ids.campaign, companyId: ids.company, fullName: name, email, emailStatus: "valid", status: "sent" });
  }
  await db.update(contacts).set({ status: "approved" }).where(eq(contacts.id, "k4"));
});

describe("chiffrement des mots de passe", () => {
  it("chiffre et déchiffre, et détecte une altération", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
    const enc = encryptSecret("mot-de-passe-d'application");
    expect(enc).not.toContain("mot-de-passe");
    expect(decryptSecret(enc)).toBe("mot-de-passe-d'application");
    expect(() => decryptSecret(enc.slice(0, -4) + "AAAA")).toThrow();
  });
});

describe("rotation des boîtes d'envoi", () => {
  it("lève une erreur explicite sans aucune boîte", async () => {
    const { pickMailbox } = await import("@/lib/outreach/mailboxes");
    await expect(pickMailbox(PLATFORM)).rejects.toThrow(/Aucune boîte d'envoi/);
  });

  it("choisit la boîte la moins chargée, garde la même boîte pour les relances, attend quand tout est plein", async () => {
    const { getDb } = await import("@/lib/db");
    const { mailboxes, messages } = await import("@/lib/db/schema");
    const { encryptSecret } = await import("@/lib/crypto");
    const { pickMailbox } = await import("@/lib/outreach/mailboxes");
    const db = await getDb();
    const box = (id: string, dailyLimit: number) => ({
      id,
      label: id,
      fromEmail: `${id}@envoi.fr`,
      smtpHost: "smtp.envoi.fr",
      smtpUser: id,
      smtpPassEnc: encryptSecret("pw"),
      dailyLimit,
    });
    await db.insert(mailboxes).values([box("a", 2), box("b", 2)]);
    // « a » a déjà envoyé 2 emails aujourd'hui : plein
    for (const [i, contactId] of ["k1", "k2"].entries()) {
      await db.insert(messages).values({ id: `m-a-${i}`, campaignId: ids.campaign, contactId, step: 1, subject: "s", body: "b", status: "sent", sentAt: new Date(), mailboxId: "a" });
    }
    expect((await pickMailbox(PLATFORM))?.id).toBe("b");
    // Relance d'une séquence partie de « a » : on attend plutôt que de changer de boîte
    expect(await pickMailbox(PLATFORM, "a")).toBeNull();
    expect((await pickMailbox(PLATFORM, "b"))?.id).toBe("b");
    // « b » se remplit à son tour
    for (const [i, contactId] of ["k3", "k4"].entries()) {
      await db.insert(messages).values({ id: `m-b-${i}`, campaignId: ids.campaign, contactId, step: 1, subject: "s", body: "b", status: "sent", sentAt: new Date(), mailboxId: "b", providerId: `<msg-${contactId}@envoi.fr>` });
    }
    expect(await pickMailbox(PLATFORM)).toBeNull();
    // Une boîte désactivée n'est jamais choisie
    await db.update(mailboxes).set({ enabled: false, dailyLimit: 100 }).where(eq(mailboxes.id, "a"));
    expect(await pickMailbox(PLATFORM)).toBeNull();
  });
});

describe("détection des réponses et rebonds", () => {
  it("classe les messages entrants", async () => {
    const { classifyInbound } = await import("@/lib/outreach/inbox");
    expect(classifyInbound({ uid: 1, from: "jean.dupont@acme.fr", subject: "Re: votre message" }).kind).toBe("reply");
    expect(classifyInbound({ uid: 2, from: "jean.dupont@acme.fr", subject: "Réponse automatique : absent" }).kind).toBe("auto");
    expect(classifyInbound({ uid: 3, from: "x@acme.fr", subject: "Re: hello", headers: "Auto-Submitted: auto-replied\r\n" }).kind).toBe("auto");
    const bounce = classifyInbound(
      {
        uid: 4,
        from: "MAILER-DAEMON@mx.envoi.fr",
        subject: "Undelivered Mail Returned to Sender",
        body: "Final-Recipient: rfc822; paul.valery@acme.fr\nAction: failed\nStatus: 5.1.1",
      },
      ["b@envoi.fr"],
    );
    expect(bounce).toEqual({ kind: "bounce", bounced: ["paul.valery@acme.fr"], messageIds: [] });
    expect(classifyInbound({ uid: 5, from: "b@envoi.fr", subject: "Re: test" }, ["b@envoi.fr"]).kind).toBe("other");
  });

  it("marque les réponses, ignore les absences, traite les rebonds et annule les relances", async () => {
    const { getDb } = await import("@/lib/db");
    const { contacts, messages } = await import("@/lib/db/schema");
    const { applyInbound } = await import("@/lib/outreach/inbox");
    const db = await getDb();
    // Relances planifiées pour tout le monde
    for (const k of ["k1", "k2", "k3", "k4"]) {
      await db.insert(messages).values({ id: `f-${k}`, campaignId: ids.campaign, contactId: k, step: 2, subject: "s", body: "b", status: "scheduled" });
    }
    const r = await applyInbound(
      [
        { uid: 1, from: "jean.dupont@acme.fr", subject: "Re: échange" }, // réponse (par adresse)
        { uid: 2, from: "autre-alias@acme.fr", subject: "Re: hello", inReplyTo: "<msg-k4@envoi.fr>" }, // réponse (par In-Reply-To)
        { uid: 3, from: "marie.curie@acme.fr", subject: "Out of office" }, // absence : ignorée
        { uid: 4, from: "mailer-daemon@mx.fr", subject: "Delivery Status Notification (Failure)", body: "Final-Recipient: rfc822;paul.valery@acme.fr" },
      ],
      ["b@envoi.fr"],
    );
    expect(r).toEqual({ replies: 2, bounces: 1 });
    const rows = Object.fromEntries((await db.select().from(contacts)).map((c) => [c.id, c]));
    expect(rows.k1.status).toBe("replied");
    expect(rows.k1.repliedAt).toBeTruthy();
    expect(rows.k4.status).toBe("replied");
    expect(rows.k2.status).toBe("sent");
    expect(rows.k3).toMatchObject({ status: "bounced", emailStatus: "invalid" });
    const followUps = Object.fromEntries((await db.select().from(messages)).filter((m) => m.step === 2).map((m) => [m.contactId, m.status]));
    expect(followUps).toEqual({ k1: "cancelled", k2: "scheduled", k3: "cancelled", k4: "cancelled" });
    // Rejouer la même synchronisation ne change rien (idempotent)
    expect(await applyInbound([{ uid: 1, from: "jean.dupont@acme.fr", subject: "Re: échange" }], [])).toEqual({ replies: 0, bounces: 0 });
  });

  it("lit les rapports encodés (Zoho, base64), retrouve l'email par son Message-ID et ignore les simples retards", async () => {
    const { getDb } = await import("@/lib/db");
    const { contacts, messages } = await import("@/lib/db/schema");
    const { applyInbound, classifyInbound } = await import("@/lib/outreach/inbox");
    const db = await getDb();
    const daemon = "mailer-daemon@mail.zoho.com";

    // Retard de remise : le serveur réessaie, ce n'est pas un rebond.
    const delayed = classifyInbound({
      uid: 7,
      from: daemon,
      subject: "Delivery Status Notification (Delay)",
      body: "Action: delayed\nStatus: 4.4.7\nWe will retry delivering your message.",
    });
    expect(delayed.kind).toBe("auto");

    // Rapport dont le texte est en base64 : l'adresse n'apparaît qu'une fois décodée.
    const text =
      "A message that you sent could not be delivered. This is a permanent error.\r\n\r\n" +
      "marie.curie@acme.fr, ERROR CODE :550 - 5.4.1 Recipient address rejected: Access denied.\r\n";
    const b64 = Buffer.from(text).toString("base64").replace(/(.{76})/g, "$1\r\n");
    const raw = `Content-Type: multipart/mixed; boundary="z"\r\n\r\n--z\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64}\r\n--z--\r\n`;
    expect(raw).not.toContain("marie.curie");
    const c = classifyInbound({ uid: 8, from: daemon, subject: "Undelivered Mail Returned to Sender", body: raw }, ["b@envoi.fr"]);
    expect(c.kind).toBe("bounce");
    expect(c.bounced).toContain("marie.curie@acme.fr");

    // Sans adresse lisible, l'email en échec est retrouvé par son Message-ID (ici coupé en quoted-printable).
    await db.update(messages).set({ providerId: "<d02ea189-caea@envoi.fr>" }).where(eq(messages.id, "m-a-1"));
    const qp = "Content-Transfer-Encoding: quoted-printable\r\n\r\nThis is a permanent error.\r\nMessage-ID:<d02ea189-ca=\r\nea@envoi.fr>\r\n";
    const r = await applyInbound([{ uid: 9, from: daemon, subject: "Undelivered Mail Returned to Sender", body: qp }], ["b@envoi.fr"]);
    expect(r).toEqual({ replies: 0, bounces: 1 });
    const [k2] = await db.select().from(contacts).where(eq(contacts.id, "k2"));
    expect(k2).toMatchObject({ status: "bounced", emailStatus: "invalid" });
    const [followUp] = await db.select().from(messages).where(eq(messages.id, "f-k2"));
    expect(followUp.status).toBe("cancelled");
  });
});

describe("planification de la lecture des boîtes", () => {
  it("réserve un créneau au plus une fois par intervalle", async () => {
    const { claimInterval } = await import("@/lib/jobs/schedule");
    expect(await claimInterval("test_interval", 5)).toBe(true);
    expect(await claimInterval("test_interval", 5)).toBe(false);
    expect(await claimInterval("autre_cle", 5)).toBe(true);
  });
});

describe("messages d'erreur des boîtes", () => {
  it("explique un refus d'identifiants IMAP et un port SMTP mal réglé", async () => {
    const { explainImapError, explainSmtpError } = await import("@/lib/outreach/mailbox-admin");
    const imap = explainImapError(Object.assign(new Error("Command failed"), { authenticationFailed: true, responseText: "Invalid credentials" }));
    expect(imap).toMatch(/accès IMAP est activé/);
    expect(imap).toContain("Invalid credentials");
    expect(explainImapError(Object.assign(new Error("Command failed"), { responseText: "IMAP access disabled" }))).toContain("IMAP access disabled");
    expect(explainSmtpError(new Error("Connection closed unexpectedly"), 465, false)).toMatch(/port 465 sans TLS direct/);
    expect(explainSmtpError(Object.assign(new Error("Invalid login: 535 Authentication Failed"), { responseCode: 535 }), 465, true)).toMatch(/mot de passe refusé/);
  });
});
