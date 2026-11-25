/** Comptes, sessions, isolation des données entre clients, quotas : sur PGlite en mémoire. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth";

const plan = { summary: "", industries: [], geographies: [], companySize: "", keywords: [], personas: [], signals: [], exclusions: [], searchQueries: ["x"], qualificationCriteria: [] };
const offer = { senderCompany: "", senderName: "", product: "", valueProposition: "", callToAction: "", bookingUrl: "", tone: "", language: "fr" };
const settings = { targetCompanies: 5, contactsPerCompany: 1, minScore: 50, autoWrite: false, deepResearch: false, sequenceSteps: 2, followUpDays: 3, seedDomains: [], webhookUrl: "" };

let admin: SessionUser;
let alice: SessionUser;
let bob: SessionUser;

beforeAll(async () => {
  delete process.env.SMTP_HOST;
  delete process.env.ADMIN_EMAILS;
  process.env.UNSUBSCRIBE_SECRET = "secret-de-test";
});

describe("mots de passe", () => {
  it("hache, vérifie et refuse un mauvais mot de passe", async () => {
    const { hashPassword, verifyPassword } = await import("@/lib/auth");
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^scrypt\$/);
    expect(h).not.toContain("correct");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("mauvais mot de passe", h)).toBe(false);
    expect(await hashPassword("correct horse battery")).not.toBe(h); // sel aléatoire
  });
});

describe("inscription et connexion", () => {
  it("le premier compte est administrateur, les suivants sont clients", async () => {
    const { createUser } = await import("@/lib/auth");
    admin = await createUser({ email: "Proprio@Plateforme.fr", name: "Proprio", password: "mot-de-passe-admin" });
    alice = await createUser({ email: "alice@client-a.fr", password: "mot-de-passe-alice" });
    bob = await createUser({ email: "bob@client-b.fr", password: "mot-de-passe-bob" });
    expect(admin.role).toBe("admin");
    expect(admin.email).toBe("proprio@plateforme.fr");
    expect(alice.role).toBe("user");
    expect(bob.role).toBe("user");
  });

  it("refuse une adresse déjà inscrite, invalide ou un mot de passe trop court", async () => {
    const { createUser } = await import("@/lib/auth");
    await expect(createUser({ email: "ALICE@client-a.fr", password: "un-autre-mot-de-passe" })).rejects.toThrow(/existe déjà/);
    await expect(createUser({ email: "pas-un-email", password: "un-autre-mot-de-passe" })).rejects.toThrow(/invalide/);
    await expect(createUser({ email: "court@x.fr", password: "court" })).rejects.toThrow(/10 caractères/);
  });

  it("connecte avec les bons identifiants et freine après plusieurs échecs", async () => {
    const { authenticate, createUser } = await import("@/lib/auth");
    expect((await authenticate(" Alice@Client-A.fr ", "mot-de-passe-alice")).id).toBe(alice.id);
    await expect(authenticate("alice@client-a.fr", "faux")).rejects.toMatchObject({ status: 401 });
    await expect(authenticate("inconnu@x.fr", "faux")).rejects.toMatchObject({ status: 401 });
    await createUser({ email: "cible@x.fr", password: "mot-de-passe-cible" });
    for (let i = 0; i < 10; i++) await expect(authenticate("cible@x.fr", "faux")).rejects.toMatchObject({ status: 401 });
    await expect(authenticate("cible@x.fr", "mot-de-passe-cible")).rejects.toMatchObject({ status: 429 });
  });

  it("gère les sessions : création, lecture, expiration, déconnexion, compte désactivé", async () => {
    const { createSession, userFromSessionToken, deleteSession } = await import("@/lib/auth");
    const { getDb } = await import("@/lib/db");
    const { sessions, users } = await import("@/lib/db/schema");
    const db = await getDb();
    const { token } = await createSession(alice.id, "test");
    expect((await userFromSessionToken(token))?.email).toBe("alice@client-a.fr");
    expect(await userFromSessionToken("jeton-inconnu")).toBeNull();
    const [stored] = await db.select().from(sessions).where(eq(sessions.userId, alice.id));
    expect(stored.id).not.toBe(token); // seule l'empreinte est stockée
    await deleteSession(token);
    expect(await userFromSessionToken(token)).toBeNull();

    const expired = await createSession(alice.id);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, alice.id));
    expect(await userFromSessionToken(expired.token)).toBeNull();

    const s2 = await createSession(bob.id);
    await db.update(users).set({ disabled: true }).where(eq(users.id, bob.id));
    expect(await userFromSessionToken(s2.token)).toBeNull();
    await db.update(users).set({ disabled: false }).where(eq(users.id, bob.id));
  });
});

describe("isolation des données entre clients", () => {
  const ids = { a: "camp-alice", b: "camp-bob", legacy: "camp-ancienne" };

  beforeAll(async () => {
    const { getDb } = await import("@/lib/db");
    const { campaigns, companies, contacts, mailboxes } = await import("@/lib/db/schema");
    const { encryptSecret } = await import("@/lib/crypto");
    const db = await getDb();
    for (const [id, userId] of [
      [ids.a, alice.id],
      [ids.b, bob.id],
      [ids.legacy, null],
    ] as const) {
      await db.insert(campaigns).values({ id, userId, name: id, prompt: "test", status: "completed", plan, offer, settings });
      await db.insert(companies).values({ id: `co-${id}`, campaignId: id, domain: "acme.fr", name: "Acme", status: "qualified" });
      // Le même prospect existe chez Alice et chez Bob
      await db.insert(contacts).values({ id: `ct-${id}`, campaignId: id, companyId: `co-${id}`, fullName: "Jean Dupont", email: "jean@acme.fr", emailStatus: "valid", status: "sent" });
    }
    const box = (id: string, userId: string | null) => ({ id, userId, label: id, fromEmail: `${id}@envoi.fr`, smtpHost: "smtp.envoi.fr", smtpUser: id, smtpPassEnc: encryptSecret("pw") });
    await db.insert(mailboxes).values([box("box-alice", alice.id), box("box-bob", bob.id), box("box-ancienne", null)]);
  });

  it("chaque client ne voit que ses campagnes ; l'administrateur voit aussi les anciennes", async () => {
    const { listCampaigns } = await import("@/lib/pipeline/campaigns");
    expect((await listCampaigns(alice)).map((c) => c.id)).toEqual([ids.a]);
    expect((await listCampaigns(bob)).map((c) => c.id)).toEqual([ids.b]);
    expect((await listCampaigns(admin)).map((c) => c.id)).toEqual([ids.legacy]);
  });

  it("refuse l'accès aux campagnes, contacts et messages d'un autre client (404)", async () => {
    const { getOwnedCampaign, getOwnedContact, ownedContactIds } = await import("@/lib/pipeline/campaigns");
    await expect(getOwnedCampaign(ids.b, alice)).rejects.toThrow(/introuvable/);
    await expect(getOwnedCampaign(ids.legacy, alice)).rejects.toThrow(/introuvable/);
    expect((await getOwnedCampaign(ids.a, alice)).id).toBe(ids.a);
    await expect(getOwnedContact(`ct-${ids.b}`, alice)).rejects.toThrow(/introuvable/);
    expect(await ownedContactIds([`ct-${ids.a}`, `ct-${ids.b}`, `ct-${ids.legacy}`], alice)).toEqual([`ct-${ids.a}`]);
  });

  it("les statistiques ne comptent que les données du client", async () => {
    const { globalStats } = await import("@/lib/pipeline/campaigns");
    const s = await globalStats(alice);
    expect(s).toMatchObject({ campaigns: 1, companies: 1, qualified: 1, contacts: 1 });
  });

  it("un client n'utilise que ses propres boîtes d'envoi", async () => {
    const { listMailboxes, pickMailbox, getMailbox } = await import("@/lib/outreach/mailboxes");
    expect((await listMailboxes({ owner: alice })).map((b) => b.id)).toEqual(["box-alice"]);
    for (let i = 0; i < 5; i++) expect((await pickMailbox(alice))?.id).toBe("box-alice");
    expect(await getMailbox("box-bob", alice)).toBeNull();
    expect((await listMailboxes({ owner: admin })).map((b) => b.id)).toEqual(["box-ancienne"]);
  });

  it("une réponse reçue dans la boîte d'Alice ne touche pas les prospects de Bob", async () => {
    const { applyInbound } = await import("@/lib/outreach/inbox");
    const { getDb } = await import("@/lib/db");
    const { contacts } = await import("@/lib/db/schema");
    const r = await applyInbound([{ uid: 1, from: "jean@acme.fr", subject: "Re: votre message" }], ["box-alice@envoi.fr"], alice);
    expect(r.replies).toBe(1);
    const db = await getDb();
    const status = async (id: string) => (await db.select().from(contacts).where(eq(contacts.id, id)))[0].status;
    expect(await status(`ct-${ids.a}`)).toBe("replied");
    expect(await status(`ct-${ids.b}`)).toBe("sent");
    expect(await status(`ct-${ids.legacy}`)).toBe("sent");
  });
});

describe("quota mensuel", () => {
  it("compte les entreprises du mois et ne limite pas l'administrateur", async () => {
    const { quotaForCampaignOwner } = await import("@/lib/quota");
    const { getDb } = await import("@/lib/db");
    const { users } = await import("@/lib/db/schema");
    const db = await getDb();
    await db.update(users).set({ monthlyCompanyLimit: 1 }).where(eq(users.id, alice.id));
    expect(await quotaForCampaignOwner(alice.id)).toEqual({ limit: 1, used: 1, remaining: 0 });
    await db.update(users).set({ monthlyCompanyLimit: 3 }).where(eq(users.id, bob.id));
    expect((await quotaForCampaignOwner(bob.id)).remaining).toBe(2);
    expect((await quotaForCampaignOwner(admin.id)).remaining).toBe(Infinity);
    expect((await quotaForCampaignOwner(null)).remaining).toBe(Infinity);
  });
});

describe("administration des comptes", () => {
  it("liste les comptes avec leur usage du mois", async () => {
    const { listAccounts } = await import("@/lib/accounts");
    const list = await listAccounts();
    const a = list.find((u) => u.email === "alice@client-a.fr")!;
    expect(a).toMatchObject({ role: "user", campaigns: 1, companiesThisMonth: 1, costThisMonth: 0 });
    expect(list.find((u) => u.role === "admin")?.email).toBe("proprio@plateforme.fr");
  });
});

describe("hôtes fournis par les clients", () => {
  it("refuse les adresses internes", async () => {
    const { assertPublicHost, assertPublicUrl, isPrivateAddress } = await import("@/lib/net-guard");
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    await expect(assertPublicHost("localhost")).rejects.toThrow(/non autorisé/);
    await expect(assertPublicHost("serveur.internal")).rejects.toThrow(/non autorisé/);
    await expect(assertPublicHost("169.254.169.254")).rejects.toThrow(/non autorisée/);
    await expect(assertPublicHost("8.8.8.8")).resolves.toBeUndefined();
    await expect(assertPublicUrl("ftp://exemple.fr/x")).rejects.toThrow(/http/);
  });
});

describe("inscriptions en masse", () => {
  it("limite le nombre d'inscriptions par adresse IP et applique la limite mensuelle par défaut", async () => {
    const { checkSignupRate, createUser } = await import("@/lib/auth");
    for (let i = 0; i < 5; i++) await checkSignupRate("203.0.113.7");
    await expect(checkSignupRate("203.0.113.7")).rejects.toMatchObject({ status: 429 });
    await expect(checkSignupRate("203.0.113.8")).resolves.toBeUndefined();
    const u = await createUser({ email: "nouveau@client.fr", password: "mot-de-passe-nouveau" });
    expect(u.monthlyCompanyLimit).toBe(50);
  });
});
