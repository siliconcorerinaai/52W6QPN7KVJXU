CREATE TABLE "prospecta"."samples" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"company_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"mime" text,
	"data" "bytea",
	"prompt" text,
	"language" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospecta"."samples" ADD CONSTRAINT "samples_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "prospecta"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."samples" ADD CONSTRAINT "samples_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "prospecta"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "samples_company" ON "prospecta"."samples" USING btree ("company_id");