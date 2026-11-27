/**
 * Envoi aux adresses sûres, côté base : taux de rebond par campagne, coupe-circuit,
 * premiers emails mis de côté puis libérés quand la règle change (ou à la demande).
 */
import { and, eq, inArray } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { campaigns, companies, contacts, messages, type Campaign, type Contact } from "@/lib/db/schema";
import { verificationProviders } from "@/lib/email/verifiers";
import { verifyEmail } from "@/lib/email/verify";
import { logEvent } from "@/lib/events";
import { enqueue } from "@/lib/jobs/queue";
import { nextSendSlot, timeZoneFor } from "@/lib/outreach/mailer";
import {
  addressTier,
  breakerTripped,
  pct,
  policyAllows,
  policyOf,
  POLICY_LABEL,
  stricter,
  TIER_LABEL,
  type AddressTier,
  type BounceHealth,
  type SendPolicy,
} from "@/lib/outreach/safety";
import { CampaignSettingsSchema } from "@/lib/types";

/** Marque des adresses déjà passées par un vérificateur juste avant l'envoi (on ne paie pas deux fois). */
export const PRESEND_NOTE = "Vérifiée avant envoi";

const since = (c: Campaign) => new Date(c.settings.sendPolicySince ?? 0);

/**
 * Taux de rebond des premiers emails depuis le dernier changement de règle,
 * en ne comptant que les adresses que la règle actuelle laisse partir.
 */
export async function bounceHealth(c: Campaign): Promise<BounceHealth> {
  const db = await getDb();
  const policy = policyOf(c.settings);
  const rows = await db
    .select({
      msgStatus: messages.status,
      sentAt: messages.sentAt,
      updatedAt: messages.updatedAt,
      ctStatus: contacts.status,
      email: contacts.email,
      emailStatus: contacts.emailStatus,
      emailConfidence: contacts.emailConfidence,
      emailSource: contacts.emailSource,
    })
    .from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(and(eq(messages.campaignId, c.id), eq(messages.step, 1), inArray(messages.status, ["sent", "failed"])));
  const from = since(c).getTime();
  let attempts = 0;
  let bounces = 0;
  for (const r of rows) {
    const bounced = r.ctStatus === "bounced";
    // Un échec d'envoi ne compte que s'il s'agit d'un rebond (pas d'une panne de connexion).
    if (r.msgStatus === "failed" && !bounced) continue;
    if ((r.sentAt ?? r.updatedAt).getTime() < from) continue;
    if (!policyAllows(policy, addressTier(r, { atSend: true }))) continue;
    attempts++;
    if (bounced) bounces++;
  }
  return { attempts, bounces, rate: attempts ? bounces / attempts : 0 };
}

async function saveSettings(c: Campaign, patch: Partial<Campaign["settings"]>, extra: Partial<Pick<Campaign, "status">> = {}) {
  const db = await getDb();
  const settings = CampaignSettingsSchema.parse({ ...c.settings, ...patch });
  await db.update(campaigns).set({ settings, ...extra, updatedAt: new Date() }).where(eq(campaigns.id, c.id));
  return settings;
}

/**
 * Coupe-circuit, appelé après chaque rebond et avant chaque premier email :
 * au-delà de 5 % de rebonds, la règle se resserre d'un cran ; si elle est déjà « Sûr », la campagne se met en pause.
 * Renvoie true si quelque chose a changé.
 */
export async function checkBounceBreaker(campaignId: string): Promise<boolean> {
  const db = await getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return false;
  const health = await bounceHealth(c);
  if (!breakerTripped(health)) return false;
  const policy = policyOf(c.settings);
  const next = stricter(policy);
  const now = new Date().toISOString();
  const rate = `${pct(health.rate)} (${health.bounces} sur ${health.attempts})`;
  if (next) {
    await saveSettings(c, { sendPolicy: next, sendPolicySince: now });
    await logEvent(
      campaignId,
      "warn",
      "safety",
      `🛡️ Taux de rebond de ${rate} : règle d'envoi passée à « ${POLICY_LABEL[next].label} ». ${POLICY_LABEL[next].detail} Votre boîte d'envoi reste protégée.`,
      { policy: next, ...health },
    );
  } else {
    await saveSettings(c, { sendPolicySince: now }, c.status === "running" ? { status: "paused" } : {});
    await logEvent(
      campaignId,
      "error",
      "safety",
      `⛔ Taux de rebond de ${rate}, même sur les adresses vérifiées : campagne mise en pause pour protéger votre boîte d'envoi. Vérifiez la liste de prospects, puis relancez.`,
      health,
    );
  }
  return true;
}

export type SendGate = { ok: true } | { ok: false; tier: AddressTier; policy: SendPolicy; reason: string };

/**
 * Le premier email peut-il partir vers cette adresse ? Si la règle le refuse et qu'un service de vérification
 * est configuré, on vérifie l'adresse une fois juste avant l'envoi (une adresse confirmée passe).
 */
export async function gateFirstEmail(c: Campaign, ct: Contact): Promise<SendGate> {
  const policy = policyOf(c.settings);
  let tier = addressTier(ct);
  if (policyAllows(policy, tier)) return { ok: true };

  if (!config.demoMode && ct.email && verificationProviders().length && !ct.notes?.startsWith(PRESEND_NOTE)) {
    const v = await verifyEmail(ct.email, ct.emailConfidence);
    const db = await getDb();
    const patch = {
      emailStatus: v.status,
      emailConfidence: v.confidence,
      notes: `${PRESEND_NOTE} : ${v.reason}`,
      ...(v.status === "valid" ? { emailSource: "verified" } : {}),
      updatedAt: new Date(),
    };
    await db.update(contacts).set(patch).where(eq(contacts.id, ct.id));
    tier = addressTier({ ...ct, ...patch });
    if (policyAllows(policy, tier)) return { ok: true };
  }
  return {
    ok: false,
    tier,
    policy,
    reason:
      tier === "unusable"
        ? "Adresse refusée par la vérification"
        : `Mis de côté : adresse ${TIER_LABEL[tier].toLowerCase()} (règle d'envoi « ${POLICY_LABEL[policy].label} »)`,
  };
}

/**
 * Remet en file les premiers emails mis de côté : ceux que la règle actuelle accepte désormais,
 * ou, avec `force` (« Envoyer quand même »), tous ceux demandés. Les envois sont étalés comme à l'approbation.
 */
export async function releaseHeld(campaignId: string, opts: { contactIds?: string[]; force?: boolean } = {}): Promise<number> {
  const db = await getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return 0;
  const conds = [eq(messages.campaignId, campaignId), eq(messages.step, 1), eq(messages.status, "held")];
  if (opts.contactIds) {
    if (!opts.contactIds.length) return 0;
    conds.push(inArray(messages.contactId, opts.contactIds));
  }
  const rows = await db
    .select({ msg: messages, ct: contacts, country: companies.country })
    .from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .innerJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(...conds));
  const policy = policyOf(c.settings);
  const force = !!opts.force;
  let offset = 0;
  for (const { msg, ct, country } of rows) {
    if (["replied", "unsubscribed", "bounced"].includes(ct.status)) continue;
    const tier = addressTier(ct);
    if (tier === "unusable" || (!force && !policyAllows(policy, tier))) continue;
    const tz = timeZoneFor(country) ?? timeZoneFor(c.plan.geographies[0]);
    const at = config.demoMode
      ? new Date(Date.now() + 2000 + offset * 1500)
      : nextSendSlot(new Date(Date.now() + offset * (120_000 + Math.random() * 120_000)), tz);
    offset++;
    await db.update(messages).set({ status: "approved", scheduledAt: at, error: null, updatedAt: new Date() }).where(eq(messages.id, msg.id));
    await enqueue("message.send", { messageId: msg.id, force }, { campaignId, runAt: at, priority: 5 });
  }
  if (offset) {
    await logEvent(
      campaignId,
      "info",
      "safety",
      force ? `📤 ${offset} premier(s) email(s) mis de côté renvoyé(s) à l'envoi à votre demande.` : `📤 ${offset} premier(s) email(s) mis de côté repartent avec la nouvelle règle d'envoi.`,
    );
  }
  return offset;
}

/** Change la règle d'envoi d'une campagne : le calcul du taux de rebond repart de zéro. */
export async function setSendPolicy(campaignId: string, policy: SendPolicy): Promise<{ released: number }> {
  const db = await getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return { released: 0 };
  if (policyOf(c.settings) === policy) return { released: 0 };
  await saveSettings(c, { sendPolicy: policy, sendPolicySince: new Date().toISOString() });
  await logEvent(campaignId, "info", "safety", `🛡️ Règle d'envoi : « ${POLICY_LABEL[policy].label} ». ${POLICY_LABEL[policy].detail}`);
  return { released: await releaseHeld(campaignId) };
}

export type SafetyOverview = {
  policy: SendPolicy;
  health: BounceHealth;
  held: number;
  /** Adresses pas encore contactées, par fiabilité. */
  pending: Record<Exclude<AddressTier, "unusable">, number>;
  verifier: boolean;
};

export async function safetyOverview(campaignId: string): Promise<SafetyOverview | null> {
  const db = await getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return null;
  const [health, held, waiting] = await Promise.all([
    bounceHealth(c),
    db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.campaignId, campaignId), eq(messages.step, 1), eq(messages.status, "held"))),
    db
      .select()
      .from(contacts)
      .where(and(eq(contacts.campaignId, campaignId), inArray(contacts.status, ["ready", "drafted", "approved"]))),
  ]);
  const pending = { verified: 0, probable: 0, guess: 0 };
  for (const ct of waiting) {
    const t = addressTier(ct);
    if (t !== "unusable") pending[t]++;
  }
  return { policy: policyOf(c.settings), health, held: held.length, pending, verifier: verificationProviders().length > 0 };
}
