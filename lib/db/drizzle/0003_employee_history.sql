CREATE TABLE IF NOT EXISTS "member_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"hourly_rate" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_baseline" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_versions_member_id_members_id_fk'
    AND conrelid = 'public.member_versions'::regclass) THEN
    ALTER TABLE "member_versions" ADD CONSTRAINT "member_versions_member_id_members_id_fk"
      FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_versions_member_date_idx" ON "member_versions" USING btree ("member_id","recorded_at");--> statement-breakpoint
INSERT INTO "member_versions" ("member_id", "name", "hourly_rate", "recorded_at", "is_baseline")
SELECT m."id", m."name", m."hourly_rate", clock_timestamp(), true
FROM "members" m WHERE NOT EXISTS (
  SELECT 1 FROM "member_versions" v WHERE v."member_id" = m."id"
);