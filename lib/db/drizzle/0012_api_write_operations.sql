ALTER TABLE "manager_grants"
  ADD COLUMN IF NOT EXISTS "granted_by" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_write_operations" (
  "operation_id" uuid PRIMARY KEY NOT NULL,
  "request_hash" text NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
