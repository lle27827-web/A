CREATE TABLE IF NOT EXISTS "personal_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"hourly_rate" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "personal_services_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "personal_services_rate_bounds" CHECK ("personal_services"."hourly_rate" between 0 and 100000000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personal_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"service_id" integer NOT NULL,
	"service_name" text NOT NULL,
	"work_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"hourly_rate" integer NOT NULL,
	"earnings" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_sessions_minutes_bounds" CHECK ("personal_sessions"."minutes" between 1 and 1440),
	CONSTRAINT "personal_sessions_rate_bounds" CHECK ("personal_sessions"."hourly_rate" between 0 and 100000000),
	CONSTRAINT "personal_sessions_earnings_nonnegative" CHECK ("personal_sessions"."earnings" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='personal_sessions_service_user_fk'
      AND conrelid='public.personal_sessions'::regclass
  ) THEN
    ALTER TABLE "personal_sessions" ADD CONSTRAINT "personal_sessions_service_user_fk"
      FOREIGN KEY ("service_id","user_id") REFERENCES "public"."personal_services"("id","user_id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_services_user_idx" ON "personal_services" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_sessions_user_date_idx" ON "personal_sessions" USING btree ("user_id","work_date");