CREATE SCHEMA IF NOT EXISTS "prospecta";
--> statement-breakpoint
CREATE TABLE "prospecta"."ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" text,
	"operation" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecta"."campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"plan" jsonb NOT NULL,
	"offer" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"discovery_rounds" integer DEFAULT 0 NOT NULL,
	"empty_rounds" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecta"."companies" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"domain" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"description" text,
	"industry" text,
	"employee_range" text,
	"location" text,
	"country" text,
	"linkedin_url" text,
	"tech_stack" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" integer,
	"score_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'discovered' NOT NULL,
	"discovered_via" text,
	"discovery_reason" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"site_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"people" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email_pattern" text,
	"has_mx" boolean,
	"catch_all" boolean,
	"language" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecta"."contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"company_id" text NOT NULL,
	"full_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"seniority" text,
	"linkedin_url" text,
	"email" text,
	"email_status" text DEFAULT 'unknown' NOT NULL,
	"email_confidence" integer DEFAULT 0 NOT NULL,
	"email_source" text,
	"relevance" integer DEFAULT 0 NOT NULL,
	"relevance_reason" text,
	"status" text DEFAULT 'new' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecta"."events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" text,
	"level" text DEFAULT 'info' NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecta"."jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"campaign_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecta"."messages" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"step" integer NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecta"."suppressions" (
	"value" text PRIMARY KEY NOT NULL,
	"reason" text DEFAULT 'unsubscribe' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospecta"."ai_usage" ADD CONSTRAINT "ai_usage_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "prospecta"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."companies" ADD CONSTRAINT "companies_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "prospecta"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."contacts" ADD CONSTRAINT "contacts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "prospecta"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "prospecta"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."events" ADD CONSTRAINT "events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "prospecta"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."jobs" ADD CONSTRAINT "jobs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "prospecta"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."messages" ADD CONSTRAINT "messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "prospecta"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "prospecta"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_campaign" ON "prospecta"."ai_usage" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_campaign_domain" ON "prospecta"."companies" USING btree ("campaign_id","domain");--> statement-breakpoint
CREATE INDEX "companies_campaign_status" ON "prospecta"."companies" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_company_name" ON "prospecta"."contacts" USING btree ("company_id","full_name");--> statement-breakpoint
CREATE INDEX "contacts_campaign_status" ON "prospecta"."contacts" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "events_campaign" ON "prospecta"."events" USING btree ("campaign_id","id");--> statement-breakpoint
CREATE INDEX "jobs_claim" ON "prospecta"."jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_contact_step" ON "prospecta"."messages" USING btree ("contact_id","step");--> statement-breakpoint
CREATE INDEX "messages_status" ON "prospecta"."messages" USING btree ("status");