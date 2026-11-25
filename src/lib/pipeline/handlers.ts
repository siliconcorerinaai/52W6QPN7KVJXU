import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  campaigns,
  companies,
  contacts,
  messages,
  suppressions,
  type Campaign,
  type Company,
  type Contact,
  type EmailStatus,
  type Job,
} from "@/lib/db/schema";
import { intelligence } from "@/lib/ai";
import { config } from "@/lib/config";
import { logEvent } from "@/lib/events";
import { enqueue, pendingJobCount, rescheduleJob, type JobType } from "@/lib/jobs/queue";
import { crawlCompanySite } from "@/lib/scrape/site";
import { candidateEmails, fromHunterPattern, inferPattern, isRoleEmail, type PatternId } from "@/lib/email/patterns";
import { detectCatchAll, domainHasMx, verifyEmail, type Verification } from "@/lib/email/verify";
import { verificationProviders } from "@/lib/email/verifiers";
import { hunterDomainPattern, hunterFindEmail } from "@/lib/email/hunter";
import { nextSendSlot, sendEmail } from "@/lib/outreach/mailer";
import { NoMailboxError, pickMailbox, type SendingMailbox } from "@/lib/outreach/mailboxes";
import { syncAllInboxes } from "@/lib/outreach/inbox";
import { errorMessage, hashString, isNonCompanyDomain, newId, normalizeDomain, splitName, uniq } from "@/lib/util";
import type { PersonHint, Signal } from "@/lib/types";
import { pushWebhook } from "./export";

type Handler = (job: Job) => Promise<void>;

async function loadCampaign(id: string): Promise<Campaign | null> {
  const db = await getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return c ?? null;
}

async function loadCompany(id: string): Promise<Company | null> {
  const db = await getDb();
  const [c] = await db.select().from(companies).where(eq(companies.id, id));
  return c ?? null;
}

async function loadContact(id: string): Promise<Contact | null> {
  const db = await getDb();
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
  return c ?? null;
}

const ctxOf = (campaignId: string) => ({ campaignId });

// ───────────────────────────── Découverte ─────────────────────────────

async function discover(job: Job) {
  const campaignId = job.payload.campaignId as string;
  const c = await loadCampaign(campaignId);
  if (!c || c.status !== "running") return;
  const db = await getDb();

  const existing = await db
    .select({ domain: companies.domain, status: companies.status })
    .from(companies)
    .where(eq(companies.campaignId, campaignId));
  const qualified = existing.filter((x) => x.status === "qualified").length;
  const analyzed = existing.filter((x) => x.status === "qualified" || x.status === "disqualified").length;
  const inFlight = existing.filter((x) => x.status === "discovered" || x.status === "researching").length;
  // Taux de qualification observé (estimation prudente au départ)
  const rate = analyzed >= 5 ? Math.min(0.9, Math.max(0.2, qualified / analyzed)) : 0.6;
  const missing = c.settings.targetCompanies - qualified - Math.round(inFlight * rate);
  if (missing <= 0) return;
  const count = Math.min(30, Math.max(5, Math.ceil(missing / rate)));

  const round = c.discoveryRounds + 1;
  await logEvent(campaignId, "info", "discover", `🔎 Recherche n°${round} : je cherche ${count} nouvelles entreprises…`);
  const res = await intelligence().discover(
    {
      prompt: c.prompt,
      plan: c.plan,
      count,
      exclude: existing.map((x) => x.domain),
      round: c.discoveryRounds,
      seeds: c.settings.seedDomains,
    },
    ctxOf(campaignId),
  );

  const known = new Set(existing.map((x) => x.domain));
  const fresh = res.companies
    .map((x) => ({ ...x, domain: normalizeDomain(x.domain) }))
    .filter((x): x is typeof x & { domain: string } => !!x.domain && !known.has(x.domain) && !isNonCompanyDomain(x.domain));

  let inserted = 0;
  for (const cand of uniq(fresh, (x) => x.domain)) {
    const [row] = await db
      .insert(companies)
      .values({
        id: newId(),
        campaignId,
        domain: cand.domain,
        name: cand.name,
        discoveredVia: res.via,
        discoveryReason: cand.reason ?? null,
        sources: cand.source ? [cand.source] : [],
      })
      .onConflictDoNothing()
      .returning({ id: companies.id });
    if (row) {
      inserted++;
      await enqueue("company.research", { companyId: row.id }, { campaignId, priority: 1 });
    }
  }

  await db
    .update(campaigns)
    .set({
      discoveryRounds: round,
      emptyRounds: inserted === 0 ? sql`${campaigns.emptyRounds} + 1` : 0,
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaignId));

  await logEvent(
    campaignId,
    inserted ? "success" : "warn",
    "discover",
    inserted
      ? `🏢 ${inserted} nouvelles entreprises trouvées : ${fresh.slice(0, 5).map((x) => x.name).join(", ")}${fresh.length > 5 ? "…" : ""}`
      : "Aucune nouvelle entreprise trouvée sur ce tour.",
    // `tech` : détails internes, visibles seulement par l'administrateur.
    { sources: res.sources.slice(0, 20), tech: { via: res.via } },
  );
}

/** Superviseur : relance la découverte tant que l'objectif n'est pas atteint, clôture la campagne à la fin. */
async function supervise(job: Job) {
  const campaignId = job.payload.campaignId as string;
  const c = await loadCampaign(campaignId);
  if (!c || c.status !== "running") return;
  const db = await getDb();

  const [counts] = await db
    .select({
      qualified: sql<number>`count(*) filter (where ${companies.status} = 'qualified')::int`,
      inFlight: sql<number>`count(*) filter (where ${companies.status} in ('discovered', 'researching'))::int`,
    })
    .from(companies)
    .where(eq(companies.campaignId, campaignId));

  const target = c.settings.targetCompanies;
  const maxRounds = Math.max(6, Math.ceil(target / 4));
  const exhausted = c.emptyRounds >= 2 || c.discoveryRounds >= maxRounds;
  const pendingDiscover = await pendingJobCount(campaignId, [
    "company.research",
    "company.contacts",
    "contact.email",
    "contact.write",
    "message.send",
    "campaign.supervise",
  ]);

  if (counts.qualified < target && !exhausted && pendingDiscover === 0 && counts.inFlight < 4) {
    await enqueue("campaign.discover", { campaignId }, { campaignId, priority: 0 });
  }

  const pending = await pendingJobCount(campaignId, ["campaign.supervise", "message.send"]);
  if (pending === 0 && pendingDiscover === 0 && (counts.qualified >= target || exhausted)) {
    await db
      .update(campaigns)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    const [leads] = await db
      .select({ n: sql<number>`count(*) filter (where ${contacts.email} is not null and ${contacts.emailStatus} <> 'invalid')::int` })
      .from(contacts)
      .where(eq(contacts.campaignId, campaignId));
    await logEvent(
      campaignId,
      "success",
      "complete",
      `🎯 Prospection terminée : ${counts.qualified} entreprises qualifiées, ${leads.n} leads avec email.${
        counts.qualified < target ? " (Objectif non atteint : élargissez le profil ou relancez « Trouver plus ».)" : ""
      }`,
    );
    if (c.settings.webhookUrl) {
      try {
        const n = await pushWebhook(campaignId, c.settings.webhookUrl);
        await logEvent(campaignId, "success", "webhook", `🔗 ${n} leads envoyés au webhook.`);
      } catch (e) {
        await logEvent(campaignId, "warn", "webhook", `Webhook en échec : ${errorMessage(e)}`);
      }
    }
    return;
  }

  await enqueue("campaign.supervise", { campaignId }, { campaignId, runAt: new Date(Date.now() + (config.demoMode ? 4000 : 10000)) });
}

// ───────────────────────────── Qualification ─────────────────────────────

async function researchCompany(job: Job) {
  const companyId = job.payload.companyId as string;
  const co = await loadCompany(companyId);
  if (!co) return;
  const c = await loadCampaign(co.campaignId);
  if (!c) return;
  const db = await getDb();
  await db.update(companies).set({ status: "researching", updatedAt: new Date() }).where(eq(companies.id, companyId));

  try {
    const digest = config.demoMode ? null : await crawlCompanySite(co.domain);
    const hasMx = config.demoMode ? true : await domainHasMx(co.domain);
    const a = await intelligence().analyze(
      {
        prompt: c.prompt,
        plan: c.plan,
        offer: c.offer,
        candidate: { name: co.name, domain: co.domain, reason: co.discoveryReason ?? undefined },
        digest,
        deep: !digest && !config.demoMode,
      },
      ctxOf(c.id),
    );

    const score = a.disqualified ? Math.min(a.fitScore, 30) : a.fitScore;
    const qualified = score >= c.settings.minScore;
    const people: PersonHint[] = uniq(
      a.people.filter((p) => p.name.trim().split(/\s+/).length >= 2),
      (p) => p.name.toLowerCase(),
    ).map((p) => ({
      name: p.name,
      title: p.title ?? undefined,
      email: p.email ?? undefined,
      linkedinUrl: p.linkedinUrl ?? undefined,
      source: digest?.url,
    }));
    const siteEmails = uniq([...(digest?.emails ?? []), ...people.map((p) => p.email).filter((e): e is string => !!e)]);
    const pattern = inferPattern(siteEmails, people, co.domain);
    const reasons = [...a.fitReasons];
    if (!hasMx) reasons.push("⚠️ Aucun serveur mail détecté sur ce domaine");
    if (a.disqualificationReason) reasons.push(`Exclusion : ${a.disqualificationReason}`);

    await db
      .update(companies)
      .set({
        name: a.name || co.name,
        website: digest?.url ?? `https://${co.domain}`,
        description: a.description,
        industry: a.industry,
        employeeRange: a.employeeRange,
        location: a.location,
        country: a.country,
        language: digest?.language?.slice(0, 2) || a.language,
        linkedinUrl: digest?.linkedinUrl ?? a.linkedinUrl,
        techStack: digest?.techStack ?? (config.demoMode ? demoTech(co.domain) : []),
        signals: a.signals.map((s) => ({ type: s.type, text: s.text, source: s.source ?? undefined, date: s.date ?? undefined })),
        score,
        scoreReasons: reasons,
        status: qualified ? "qualified" : "disqualified",
        sources: uniq([...co.sources, ...a.sources]).slice(0, 30),
        siteEmails,
        people,
        emailPattern: pattern?.pattern ?? null,
        hasMx,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));

    if (qualified) {
      await logEvent(c.id, "success", "qualify", `✅ ${a.name} qualifiée — score ${score}/100 · ${a.fitReasons[0] ?? ""}`, { companyId });
      await enqueue("company.contacts", { companyId }, { campaignId: c.id, priority: 2 });
    } else {
      await logEvent(c.id, "info", "qualify", `✗ ${a.name} écartée (score ${score}) · ${a.disqualificationReason ?? a.fitReasons[0] ?? ""}`, {
        companyId,
      });
    }
  } catch (e) {
    const final = job.attempts >= job.maxAttempts;
    await db
      .update(companies)
      .set({ status: final ? "failed" : "discovered", error: errorMessage(e), updatedAt: new Date() })
      .where(eq(companies.id, companyId));
    throw e;
  }
}

function demoTech(domain: string) {
  const all = ["WordPress", "HubSpot", "Google Analytics", "Webflow", "Intercom", "Axeptio", "Calendly", "Matomo"];
  const h = hashString(domain);
  return all.filter((_, i) => (h >> i) & 1).slice(0, 4);
}

// ───────────────────────────── Décideurs ─────────────────────────────

async function findContacts(job: Job) {
  const companyId = job.payload.companyId as string;
  const co = await loadCompany(companyId);
  if (!co || co.status !== "qualified") return;
  const c = await loadCampaign(co.campaignId);
  if (!c) return;
  const db = await getDb();
  const want = c.settings.contactsPerCompany;

  const res = await intelligence().findPeople({ plan: c.plan, company: co, count: want + 2, deep: c.settings.deepResearch }, ctxOf(c.id));

  const signals: Signal[] = uniq(
    [...co.signals, ...res.signals.map((s) => ({ type: s.type, text: s.text, source: s.source ?? undefined, date: s.date ?? undefined }))],
    (s) => s.text.toLowerCase().slice(0, 60),
  ).slice(0, 12);
  const people: PersonHint[] = uniq(
    [
      ...co.people,
      ...res.people.map((p) => ({ name: p.name, title: p.title, email: p.email ?? undefined, linkedinUrl: p.linkedinUrl ?? undefined })),
    ],
    (p) => p.name.toLowerCase(),
  );
  const pattern = co.emailPattern ?? inferPattern(co.siteEmails, people, co.domain)?.pattern ?? null;
  await db
    .update(companies)
    .set({ signals, people, emailPattern: pattern, sources: uniq([...co.sources, ...res.sources]).slice(0, 40), updatedAt: new Date() })
    .where(eq(companies.id, companyId));

  const ranked = res.people
    .filter((p) => p.name.trim().split(/\s+/).length >= 2 && p.relevance >= 30)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, want);

  const created: string[] = [];
  for (const p of ranked) {
    const { first, last } = splitName(p.name);
    const domainEmail = p.email && p.email.toLowerCase().endsWith(`@${co.domain}`) ? p.email.toLowerCase() : null;
    const [row] = await db
      .insert(contacts)
      .values({
        id: newId(),
        campaignId: c.id,
        companyId,
        fullName: p.name.trim(),
        firstName: first,
        lastName: last,
        title: p.title,
        seniority: p.seniority,
        linkedinUrl: p.linkedinUrl,
        email: domainEmail,
        emailSource: domainEmail ? "published" : null,
        relevance: p.relevance,
        relevanceReason: p.reason,
        sources: p.sourceUrl ? [p.sourceUrl] : [],
      })
      .onConflictDoNothing()
      .returning({ id: contacts.id, name: contacts.fullName, title: contacts.title });
    if (row) created.push(row.id);
  }

  // Repli : adresse générique publiée sur le site
  if (!created.length) {
    const generic = co.siteEmails.find((e) => e.endsWith(`@${co.domain}`) && isRoleEmail(e));
    if (generic) {
      const [row] = await db
        .insert(contacts)
        .values({
          id: newId(),
          campaignId: c.id,
          companyId,
          fullName: `Équipe ${co.name}`,
          title: "Adresse générique",
          email: generic,
          emailSource: "published",
          relevance: 20,
          relevanceReason: "Aucun décideur identifié : adresse générique publiée sur le site",
        })
        .onConflictDoNothing()
        .returning({ id: contacts.id });
      if (row) created.push(row.id);
    }
  }

  for (const id of created) await enqueue("contact.email", { contactId: id }, { campaignId: c.id, priority: 3 });
  await logEvent(
    c.id,
    created.length ? "success" : "warn",
    "contacts",
    created.length
      ? `👥 ${co.name} : ${ranked.map((p) => `${p.name} (${p.title})`).join(", ") || "adresse générique"}`
      : `Aucun décideur trouvé chez ${co.name}.`,
    { companyId },
  );
}

// ───────────────────────────── Emails ─────────────────────────────

function demoVerification(email: string): Verification {
  const r = hashString(email) % 100;
  if (r < 62) return { status: "valid", confidence: 92 + (r % 7), reason: "Boîte confirmée (simulation)" };
  if (r < 85) return { status: "risky", confidence: 55 + (r % 20), reason: "Motif probable, non confirmé (simulation)" };
  if (r < 95) return { status: "catch_all", confidence: 65, reason: "Domaine catch-all (simulation)" };
  return { status: "invalid", confidence: 0, reason: "Adresse refusée (simulation)" };
}

async function findEmail(job: Job) {
  const contactId = job.payload.contactId as string;
  const ct = await loadContact(contactId);
  if (!ct) return;
  const co = await loadCompany(ct.companyId);
  const c = await loadCampaign(ct.campaignId);
  if (!co || !c) return;
  const db = await getDb();
  await db.update(contacts).set({ status: "searching_email", updatedAt: new Date() }).where(eq(contacts.id, contactId));

  const domain = co.domain;
  let email = ct.email;
  let source = ct.emailSource;
  let prior = email ? 90 : 0;
  let verification: Verification | null = null;
  let pattern = co.emailPattern as PatternId | null;

  if (!email) {
    if (!pattern && !config.demoMode) {
      const h = await hunterDomainPattern(domain);
      if (h) {
        pattern = fromHunterPattern(h.pattern) ?? inferPattern(h.emails, co.people, domain)?.pattern ?? null;
        if (pattern) await db.update(companies).set({ emailPattern: pattern }).where(eq(companies.id, co.id));
      }
    }
    if (!pattern && !config.demoMode && ct.firstName && ct.lastName) {
      const f = await hunterFindEmail(domain, ct.firstName, ct.lastName);
      if (f) {
        email = f.email.toLowerCase();
        prior = Math.max(40, Math.min(95, f.score));
        source = "hunter";
      }
    }
    if (!email) {
      const candidates = candidateEmails(ct.fullName, domain, pattern, ct.firstName, ct.lastName);
      if (!candidates.length) {
        await db
          .update(contacts)
          .set({ status: "no_email", emailStatus: "not_found", updatedAt: new Date() })
          .where(eq(contacts.id, contactId));
        return;
      }
      const providers = config.demoMode ? [] : verificationProviders();
      if ((config.email.smtpVerify || providers.length) && !config.demoMode) {
        const catchAll = config.email.smtpVerify ? await detectCatchAll(domain) : null;
        if (catchAll !== null && co.catchAll !== catchAll) {
          await db.update(companies).set({ catchAll }).where(eq(companies.id, co.id));
        }
        if (catchAll !== true) {
          // Chaque vérification par un service est facturée : 3 essais au plus (6 en SMTP direct)
          for (const cand of candidates.slice(0, providers.length ? 3 : 6)) {
            const v = await verifyEmail(cand, 60);
            if (v.status === "valid") {
              email = cand;
              verification = v;
              source = providers.length ? "verified" : "smtp";
              break;
            }
            if (v.status === "catch_all") {
              // Domaine qui accepte tout : impossible de départager les variantes, on garde la plus probable
              email = candidates[0];
              verification = { ...v, confidence: pattern ? 75 : 55 };
              source = pattern ? "pattern" : "pattern-guess";
              break;
            }
          }
        }
      }
      if (!email) {
        email = candidates[0];
        prior = pattern ? 75 : 45;
        source = pattern ? "pattern" : "pattern-guess";
      }
    }
  }

  verification ??= config.demoMode ? demoVerification(email) : await verifyEmail(email, prior);
  const usable: EmailStatus[] = ["valid", "risky", "catch_all"];
  const ok = usable.includes(verification.status);

  await db
    .update(contacts)
    .set({
      email,
      emailStatus: verification.status,
      emailConfidence: verification.confidence,
      emailSource: source,
      status: ok ? "ready" : "no_email",
      notes: verification.reason,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, contactId));

  await logEvent(
    c.id,
    ok ? "success" : "warn",
    "email",
    ok
      ? `📧 ${ct.fullName} → ${email} (${statusLabel(verification.status)}, ${verification.confidence}%)`
      : `${ct.fullName} : pas d'email exploitable (${verification.reason})`,
    { contactId },
  );

  if (ok && c.settings.autoWrite) await enqueue("contact.write", { contactId }, { campaignId: c.id, priority: 4 });
}

function statusLabel(s: EmailStatus) {
  return { valid: "vérifié", risky: "probable", catch_all: "catch-all", invalid: "invalide", unknown: "inconnu", not_found: "introuvable" }[s];
}

// ───────────────────────────── Rédaction ─────────────────────────────

async function writeContact(job: Job) {
  const contactId = job.payload.contactId as string;
  const ct = await loadContact(contactId);
  if (!ct || !ct.email) return;
  if (["sent", "replied", "unsubscribed", "bounced"].includes(ct.status)) return;
  const co = await loadCompany(ct.companyId);
  const c = await loadCampaign(ct.campaignId);
  if (!co || !c) return;
  const db = await getDb();

  const seq = await intelligence().writeSequence(
    { plan: c.plan, offer: c.offer, company: co, contact: ct, steps: c.settings.sequenceSteps, followUpDays: c.settings.followUpDays },
    ctxOf(c.id),
  );

  await db.delete(messages).where(and(eq(messages.contactId, contactId), inArray(messages.status, ["draft", "approved", "cancelled"])));
  for (const [i, s] of seq.steps.entries()) {
    await db
      .insert(messages)
      .values({
        id: newId(),
        campaignId: c.id,
        contactId,
        step: i + 1,
        delayDays: i === 0 ? 0 : s.delayDays || c.settings.followUpDays,
        subject: s.subject,
        body: s.body,
        status: "draft",
      })
      .onConflictDoNothing();
  }
  await db.update(contacts).set({ status: "drafted", updatedAt: new Date() }).where(eq(contacts.id, contactId));
  await logEvent(c.id, "info", "write", `✍️ Séquence de ${seq.steps.length} emails rédigée pour ${ct.fullName} (${co.name})`, { contactId });
}

// ───────────────────────────── Envoi ─────────────────────────────

async function isSuppressed(email: string) {
  const db = await getDb();
  const domain = `@${email.split("@")[1]}`;
  const rows = await db.select().from(suppressions).where(inArray(suppressions.value, [email.toLowerCase(), domain]));
  return rows.length > 0;
}

async function sendMessage(job: Job) {
  const messageId = job.payload.messageId as string;
  const db = await getDb();
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!msg || !["approved", "scheduled"].includes(msg.status)) return;
  const ct = await loadContact(msg.contactId);
  if (!ct) return;
  const cancel = async (reason: string) => {
    await db.update(messages).set({ status: "cancelled", error: reason, updatedAt: new Date() }).where(eq(messages.id, msg.id));
  };

  if (["replied", "unsubscribed", "bounced"].includes(ct.status)) return cancel(`Contact ${ct.status}`);
  if (!ct.email || ct.emailStatus === "invalid") return cancel("Pas d'email valide");
  if (await isSuppressed(ct.email)) {
    await db.update(contacts).set({ status: "unsubscribed" }).where(eq(contacts.id, ct.id));
    return cancel("Adresse dans la liste d'exclusion");
  }

  // Le premier email de la séquence (pour le fil et la boîte d'envoi des relances)
  const [first] =
    msg.step > 1
      ? await db
          .select()
          .from(messages)
          .where(and(eq(messages.contactId, ct.id), eq(messages.step, 1)))
      : [undefined];

  let mailbox: SendingMailbox | null = null;
  if (!config.demoMode) {
    const slot = nextSendSlot();
    if (slot.getTime() - Date.now() > 60_000) return rescheduleJob(job, slot);
    try {
      mailbox = await pickMailbox(first?.mailboxId ?? null);
    } catch (e) {
      if (e instanceof NoMailboxError) {
        await db.update(messages).set({ status: "failed", error: e.message, updatedAt: new Date() }).where(eq(messages.id, msg.id));
        await logEvent(msg.campaignId, "error", "send", `Envoi impossible : ${e.message}`);
        return;
      }
      throw e;
    }
    if (!mailbox) {
      // Toutes les boîtes ont atteint leur limite du jour : on reprend demain
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      return rescheduleJob(job, nextSendSlot(tomorrow));
    }
  }

  let subject = msg.subject;
  let inReplyTo: string | null = null;
  if (first?.status === "sent") {
    subject = `Re: ${first.subject}`;
    inReplyTo = first.providerId;
  }

  let providerId: string;
  try {
    if (config.demoMode) {
      providerId = `demo-${newId()}`;
    } else {
      const res = await sendEmail({ to: ct.email, toName: ct.fullName, subject, body: msg.body, contactId: ct.id, inReplyTo }, mailbox!);
      providerId = res.messageId;
    }
  } catch (e) {
    const err = errorMessage(e);
    const hardBounce = /\b55[0-4]\b|user unknown|does not exist|mailbox unavailable/i.test(err);
    if (hardBounce) {
      await db.update(contacts).set({ status: "bounced", emailStatus: "invalid" }).where(eq(contacts.id, ct.id));
      await db.update(messages).set({ status: "failed", error: err, updatedAt: new Date() }).where(eq(messages.id, msg.id));
      await logEvent(msg.campaignId, "error", "send", `Rebond définitif pour ${ct.email} : ${err}`);
      return;
    }
    throw e;
  }

  const now = new Date();
  await db
    .update(messages)
    .set({ status: "sent", sentAt: now, providerId, subject, mailboxId: mailbox?.id ?? "demo", error: null, updatedAt: now })
    .where(eq(messages.id, msg.id));
  await db.update(contacts).set({ status: "sent", updatedAt: now }).where(eq(contacts.id, ct.id));
  await logEvent(
    msg.campaignId,
    "success",
    "send",
    `📨 ${config.demoMode ? "[démo — non envoyé] " : ""}Email ${msg.step} envoyé à ${ct.fullName} <${ct.email}>${mailbox ? ` depuis ${mailbox.fromEmail}` : ""}`,
    { contactId: ct.id },
  );

  // Planifie l'étape suivante
  const [next] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.contactId, ct.id), eq(messages.step, msg.step + 1), inArray(messages.status, ["approved", "draft"])));
  if (next) {
    const delayMs = (config.demoMode ? 20_000 : next.delayDays * 86_400_000) || 86_400_000;
    const at = config.demoMode ? new Date(Date.now() + delayMs) : nextSendSlot(new Date(Date.now() + delayMs));
    await db.update(messages).set({ status: "scheduled", scheduledAt: at, updatedAt: now }).where(eq(messages.id, next.id));
    await enqueue("message.send", { messageId: next.id }, { campaignId: msg.campaignId, runAt: at, priority: 5 });
  }
}

// ───────────────────────────── Réponses et rebonds ─────────────────────────────

async function syncInboxes() {
  const r = await syncAllInboxes();
  console.log(`[inbox] ${r.mailboxes} boîte(s), ${r.scanned} message(s) lus, ${r.replies} réponse(s), ${r.bounces} rebond(s)`);
  if (r.errors.length && r.errors.length === r.mailboxes) throw new Error(r.errors.join(" ; "));
}

const HANDLERS: Record<JobType, Handler> = {
  "campaign.discover": discover,
  "campaign.supervise": supervise,
  "company.research": researchCompany,
  "company.contacts": findContacts,
  "contact.email": findEmail,
  "contact.write": writeContact,
  "message.send": sendMessage,
  "mailbox.sync": syncInboxes,
};

export async function runJob(job: Job) {
  const handler = HANDLERS[job.type as JobType];
  if (!handler) throw new Error(`Type de job inconnu : ${job.type}`);
  await handler(job);
}

