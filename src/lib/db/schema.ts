import {
  pgSchema,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  serial,
  doublePrecision,
  uniqueIndex,
  index,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";
import type { CampaignPlan, CampaignOffer, CampaignSettings, Signal, PersonHint } from "../types";

const now = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * Toutes les tables vivent dans un schéma Postgres dédié : Prospecta peut partager une base
 * existante (Supabase…) sans collision de noms, et ses tables ne sont pas exposées par l'API
 * REST publique de Supabase (qui ne sert que le schéma `public`).
 */
export const prospecta = pgSchema("prospecta");

/** Comptes clients. Le premier compte créé devient administrateur (propriétaire de la plateforme). */
export const users = prospecta.table(
  "users",
  {
    id: text().primaryKey(),
    email: text().notNull(), // toujours en minuscules
    name: text().notNull().default(""),
    passwordHash: text().notNull(),
    role: text().$type<"user" | "admin">().notNull().default("user"),
    /** Entreprises analysées autorisées par mois (protège les coûts) ; 0 = illimité. */
    monthlyCompanyLimit: integer().notNull().default(100),
    disabled: boolean().notNull().default(false),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [uniqueIndex("users_email").on(t.email)],
);

/** Sessions de connexion : seul le hachage du jeton est stocké. */
export const sessions = prospecta.table(
  "sessions",
  {
    id: text().primaryKey(), // sha256 du jeton du cookie
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    userAgent: text(),
    createdAt: now(),
  },
  (t) => [index("sessions_user").on(t.userId)],
);

export const campaigns = prospecta.table("campaigns", {
  id: text().primaryKey(),
  userId: text().references(() => users.id, { onDelete: "cascade" }),
  name: text().notNull(),
  prompt: text().notNull(),
  status: text().$type<CampaignStatus>().notNull().default("draft"),
  plan: jsonb().$type<CampaignPlan>().notNull(),
  offer: jsonb().$type<CampaignOffer>().notNull(),
  settings: jsonb().$type<CampaignSettings>().notNull(),
  discoveryRounds: integer().notNull().default(0),
  emptyRounds: integer().notNull().default(0),
  completedAt: timestamp({ withTimezone: true }),
  error: text(),
  createdAt: now(),
  updatedAt: now(),
});

export const companies = prospecta.table(
  "companies",
  {
    id: text().primaryKey(),
    campaignId: text()
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    domain: text().notNull(),
    name: text().notNull(),
    website: text(),
    description: text(),
    industry: text(),
    employeeRange: text(),
    location: text(),
    country: text(),
    linkedinUrl: text(),
    techStack: jsonb().$type<string[]>().notNull().default([]),
    signals: jsonb().$type<Signal[]>().notNull().default([]),
    score: integer(),
    scoreReasons: jsonb().$type<string[]>().notNull().default([]),
    status: text().$type<CompanyStatus>().notNull().default("discovered"),
    discoveredVia: text(),
    discoveryReason: text(),
    sources: jsonb().$type<string[]>().notNull().default([]),
    siteEmails: jsonb().$type<string[]>().notNull().default([]),
    people: jsonb().$type<PersonHint[]>().notNull().default([]),
    emailPattern: text(),
    hasMx: boolean(),
    catchAll: boolean(),
    language: text(),
    error: text(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [
    uniqueIndex("companies_campaign_domain").on(t.campaignId, t.domain),
    index("companies_campaign_status").on(t.campaignId, t.status),
  ],
);

export type ReplyCategory = "interested" | "question" | "not_now" | "not_interested" | "unsubscribe" | "auto" | "other";
export type ReplyStatus = "new" | "handled" | "answered";

/**
 * Conversation avec un prospect : ses réponses (direction « in ») et les nôtres envoyées depuis
 * la boîte de réception (« out »). Les réponses entrantes sont classées par l'IA, qui prépare un brouillon.
 */
export const replies = prospecta.table(
  "replies",
  {
    id: text().primaryKey(),
    campaignId: text()
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    mailboxId: text(),
    direction: text().$type<"in" | "out">().notNull().default("in"),
    messageId: text(),
    inReplyTo: text(),
    fromEmail: text().notNull(),
    subject: text().notNull().default(""),
    body: text().notNull().default(""),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    category: text().$type<ReplyCategory>(),
    summary: text(),
    draftSubject: text(),
    draftBody: text(),
    status: text().$type<ReplyStatus>().notNull().default("new"),
    error: text(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [
    uniqueIndex("replies_message").on(t.messageId),
    index("replies_contact").on(t.contactId),
    index("replies_campaign_status").on(t.campaignId, t.status),
  ],
);
export type Reply = typeof replies.$inferSelect;

/** Octets bruts (images) : Buffer côté Node, quel que soit le pilote (postgres-js ou PGlite). */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (v) => v,
  fromDriver: (v) => Buffer.from(v),
});

export type SampleStatus = "pending" | "ready" | "failed";

/**
 * Échantillon visuel offert à une entreprise prospectée (visuel promo à son image).
 * L'identifiant, aléatoire, sert d'adresse publique : /v/<id>.
 */
export const samples = prospecta.table(
  "samples",
  {
    id: text().primaryKey(),
    campaignId: text()
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    status: text().$type<SampleStatus>().notNull().default("pending"),
    mime: text(),
    data: bytea(),
    prompt: text(),
    language: text(),
    error: text(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [uniqueIndex("samples_company").on(t.companyId)],
);
export type Sample = typeof samples.$inferSelect;

export const contacts = prospecta.table(
  "contacts",
  {
    id: text().primaryKey(),
    campaignId: text()
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    fullName: text().notNull(),
    firstName: text(),
    lastName: text(),
    title: text(),
    seniority: text(),
    linkedinUrl: text(),
    email: text(),
    emailStatus: text().$type<EmailStatus>().notNull().default("unknown"),
    emailConfidence: integer().notNull().default(0),
    emailSource: text(),
    relevance: integer().notNull().default(0),
    relevanceReason: text(),
    status: text().$type<ContactStatus>().notNull().default("new"),
    sources: jsonb().$type<string[]>().notNull().default([]),
    notes: text(),
    repliedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [
    uniqueIndex("contacts_company_name").on(t.companyId, t.fullName),
    index("contacts_campaign_status").on(t.campaignId, t.status),
  ],
);

export const messages = prospecta.table(
  "messages",
  {
    id: text().primaryKey(),
    campaignId: text()
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    step: integer().notNull(),
    delayDays: integer().notNull().default(0),
    subject: text().notNull(),
    body: text().notNull(),
    status: text().$type<MessageStatus>().notNull().default("draft"),
    scheduledAt: timestamp({ withTimezone: true }),
    sentAt: timestamp({ withTimezone: true }),
    providerId: text(),
    mailboxId: text(),
    error: text(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [
    uniqueIndex("messages_contact_step").on(t.contactId, t.step),
    index("messages_status").on(t.status),
  ],
);

export const events = prospecta.table(
  "events",
  {
    id: serial().primaryKey(),
    campaignId: text().references(() => campaigns.id, { onDelete: "cascade" }),
    level: text().$type<"info" | "success" | "warn" | "error">().notNull().default("info"),
    kind: text().notNull(),
    message: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>(),
    createdAt: now(),
  },
  (t) => [index("events_campaign").on(t.campaignId, t.id)],
);

export const jobs = prospecta.table(
  "jobs",
  {
    id: serial().primaryKey(),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    campaignId: text().references(() => campaigns.id, { onDelete: "cascade" }),
    status: text().$type<"queued" | "running" | "done" | "failed" | "cancelled">().notNull().default("queued"),
    priority: integer().notNull().default(0),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(3),
    runAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp({ withTimezone: true }),
    lockedBy: text(),
    lastError: text(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [index("jobs_claim").on(t.status, t.runAt, t.priority)],
);

export const aiUsage = prospecta.table(
  "ai_usage",
  {
    id: serial().primaryKey(),
    campaignId: text().references(() => campaigns.id, { onDelete: "cascade" }),
    operation: text().notNull(),
    model: text().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cacheReadTokens: integer().notNull().default(0),
    webSearches: integer().notNull().default(0),
    costUsd: doublePrecision().notNull().default(0),
    createdAt: now(),
  },
  (t) => [index("ai_usage_campaign").on(t.campaignId)],
);

/** Boîtes d'envoi (rotation, limite quotidienne, détection des réponses par IMAP). */
export const mailboxes = prospecta.table("mailboxes", {
  id: text().primaryKey(),
  userId: text().references(() => users.id, { onDelete: "cascade" }),
  label: text().notNull(),
  fromName: text().notNull().default(""),
  fromEmail: text().notNull(),
  smtpHost: text().notNull(),
  smtpPort: integer().notNull().default(587),
  smtpSecure: boolean().notNull().default(false),
  smtpUser: text().notNull(),
  smtpPassEnc: text().notNull(),
  imapHost: text(),
  imapPort: integer().notNull().default(993),
  imapSecure: boolean().notNull().default(true),
  dailyLimit: integer().notNull().default(40),
  enabled: boolean().notNull().default(true),
  lastSyncAt: timestamp({ withTimezone: true }),
  lastError: text(),
  createdAt: now(),
  updatedAt: now(),
});

/** Petit stockage clé / valeur (curseurs de synchronisation…). */
export const appState = prospecta.table("app_state", {
  key: text().primaryKey(),
  value: jsonb().$type<Record<string, unknown>>().notNull(),
  updatedAt: now(),
});

/** Exclusions par compte ; userId vide = exclusion valable pour tous les comptes. */
export const suppressions = prospecta.table(
  "suppressions",
  {
    userId: text().notNull().default(""),
    value: text().notNull(), // email ou @domaine
    reason: text().notNull().default("unsubscribe"),
    createdAt: now(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.value] })],
);

export type CampaignStatus = "draft" | "running" | "paused" | "completed" | "failed";
export type CompanyStatus = "discovered" | "researching" | "qualified" | "disqualified" | "failed";
export type EmailStatus = "unknown" | "valid" | "catch_all" | "risky" | "invalid" | "not_found";
export type ContactStatus =
  | "new"
  | "searching_email"
  | "ready"
  | "no_email"
  | "drafted"
  | "approved"
  | "sent"
  | "replied"
  | "bounced"
  | "unsubscribed";
export type MessageStatus = "draft" | "approved" | "scheduled" | "sent" | "failed" | "cancelled";

export type Campaign = typeof campaigns.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Mailbox = typeof mailboxes.$inferSelect;
export type User = typeof users.$inferSelect;
