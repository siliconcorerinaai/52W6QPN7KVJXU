CREATE TABLE "prospecta"."replies" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"mailbox_id" text,
	"direction" text DEFAULT 'in' NOT NULL,
	"message_id" text,
	"in_reply_to" text,
	"from_email" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text,
	"summary" text,
	"draft_subject" text,
	"draft_body" text,
	"status" text DEFAULT 'new' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospecta"."replies" ADD CONSTRAINT "replies_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "prospecta"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."replies" ADD CONSTRAINT "replies_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "prospecta"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "replies_message" ON "prospecta"."replies" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "replies_contact" ON "prospecta"."replies" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "replies_campaign_status" ON "prospecta"."replies" USING btree ("campaign_id","status");