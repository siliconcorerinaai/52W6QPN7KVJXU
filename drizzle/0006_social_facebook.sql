CREATE TABLE "prospecta"."social_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"company_id" text NOT NULL,
	"channel" text DEFAULT 'facebook' NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospecta"."companies" ADD COLUMN "facebook_url" text;--> statement-breakpoint
ALTER TABLE "prospecta"."companies" ADD COLUMN "instagram_url" text;--> statement-breakpoint
ALTER TABLE "prospecta"."companies" ADD COLUMN "socials_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospecta"."social_messages" ADD CONSTRAINT "social_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "prospecta"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."social_messages" ADD CONSTRAINT "social_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "prospecta"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_messages_company" ON "prospecta"."social_messages" USING btree ("company_id","channel");--> statement-breakpoint
CREATE INDEX "social_messages_campaign" ON "prospecta"."social_messages" USING btree ("campaign_id");