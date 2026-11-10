CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "business_id" text NOT NULL,
  "actor_email" text,
  "action" text NOT NULL,
  "entity" text NOT NULL,
  "entity_id" text NOT NULL,
  "before_json" jsonb,
  "after_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_business_id_idx"
  ON "audit_logs" USING btree ("business_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_business_created_idx"
  ON "audit_logs" USING btree ("business_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_entity_created_idx"
  ON "audit_logs" USING btree ("business_id", "entity", "entity_id", "created_at");
