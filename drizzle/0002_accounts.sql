CREATE TABLE "prospecta"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecta"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"monthly_company_limit" integer DEFAULT 100 NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospecta"."campaigns" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "prospecta"."mailboxes" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "prospecta"."suppressions" DROP CONSTRAINT IF EXISTS "suppressions_pkey";--> statement-breakpoint
ALTER TABLE "prospecta"."suppressions" ADD COLUMN "user_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prospecta"."suppressions" ADD CONSTRAINT "suppressions_user_id_value_pk" PRIMARY KEY("user_id","value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_user" ON "prospecta"."campaigns" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "prospecta"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "prospecta"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user" ON "prospecta"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email" ON "prospecta"."users" USING btree ("email");--> statement-breakpoint
ALTER TABLE "prospecta"."campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "prospecta"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."mailboxes" ADD CONSTRAINT "mailboxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "prospecta"."users"("id") ON DELETE cascade ON UPDATE no action;