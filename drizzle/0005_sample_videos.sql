CREATE TABLE "prospecta"."sample_videos" (
	"sample_id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"job_id" text,
	"model" text,
	"mime" text,
	"data" "bytea",
	"error" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospecta"."sample_videos" ADD CONSTRAINT "sample_videos_sample_id_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "prospecta"."samples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecta"."sample_videos" ADD CONSTRAINT "sample_videos_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "prospecta"."campaigns"("id") ON DELETE cascade ON UPDATE no action;