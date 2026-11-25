CREATE TABLE "prospecta"."app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecta"."mailboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"from_email" text NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"smtp_secure" boolean DEFAULT false NOT NULL,
	"smtp_user" text NOT NULL,
	"smtp_pass_enc" text NOT NULL,
	"imap_host" text,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_secure" boolean DEFAULT true NOT NULL,
	"daily_limit" integer DEFAULT 40 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospecta"."contacts" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospecta"."messages" ADD COLUMN "mailbox_id" text;