ALTER TABLE "treatment_cards" ADD COLUMN IF NOT EXISTS "first_used_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "treatment_cards" AS card
SET "first_used_at" = history.first_used_at
FROM (
  SELECT "card_id", min("created_at") AS first_used_at
  FROM "service_sessions" WHERE "card_id" IS NOT NULL GROUP BY "card_id"
) AS history
WHERE card."id" = history."card_id" AND card."first_used_at" IS NULL;