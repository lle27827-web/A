CREATE TABLE IF NOT EXISTS "personal_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"use_facility_rates" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_top_ups" DROP CONSTRAINT IF EXISTS "card_top_ups_minutes_positive";--> statement-breakpoint
ALTER TABLE "personal_services" ADD COLUMN IF NOT EXISTS "facility_service_id" integer;--> statement-breakpoint
ALTER TABLE "personal_sessions" ADD COLUMN IF NOT EXISTS "customer_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_sessions" ADD COLUMN IF NOT EXISTS "request_id" text;--> statement-breakpoint
ALTER TABLE "personal_sessions" ADD COLUMN IF NOT EXISTS "source_session_id" integer;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_services_facility_user_unique' AND conrelid = 'public.personal_services'::regclass) THEN
    ALTER TABLE "personal_services" ADD CONSTRAINT "personal_services_facility_user_unique" UNIQUE("user_id","facility_service_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_sessions_request_user_unique' AND conrelid = 'public.personal_sessions'::regclass) THEN
    ALTER TABLE "personal_sessions" ADD CONSTRAINT "personal_sessions_request_user_unique" UNIQUE("user_id","request_id");
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "card_top_ups" ADD CONSTRAINT "card_top_ups_minutes_positive" CHECK ("card_top_ups"."minutes" > 0 or ("card_top_ups"."minutes" = 0 and "card_top_ups"."source" = 'merged_card'));