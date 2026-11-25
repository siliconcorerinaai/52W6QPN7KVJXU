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
} from "drizzle-orm/pg-core";
import type { CampaignPlan, CampaignOffer, CampaignSettings, Signal, PersonHint } from "../types";

const now = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * Toutes les tables vivent dans un schéma Postgres dédié : Prospecta peut partager une base
 * existante (Supabase…) sans collision de noms, et ses tables ne sont pas exposées par l'API
 * REST publique de Supabase (qui ne sert que le schéma `public`).
 */
export const prospecta = pgSchema("prospecta");

export const campaigns = prospecta.table("campaigns", {
  id: text().primaryKey(),
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

export const suppressions = prospecta.table("suppressions", {
  value: text().primaryKey(), // email ou @domaine
  reason: text().notNull().default("unsubscribe"),
  createdAt: now(),
});

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
