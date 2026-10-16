CREATE TABLE IF NOT EXISTS "card_top_ups" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"minutes" integer NOT NULL,
	"amount" integer NOT NULL,
	"payment_date" date NOT NULL,
	"source" text DEFAULT 'topup' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_top_ups_minutes_positive" CHECK ("card_top_ups"."minutes" > 0),
	CONSTRAINT "card_top_ups_amount_nonnegative" CHECK ("card_top_ups"."amount" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'card_top_ups_card_id_treatment_cards_id_fk'
      AND conrelid = 'public.card_top_ups'::regclass
  ) THEN
    ALTER TABLE "card_top_ups" ADD CONSTRAINT "card_top_ups_card_id_treatment_cards_id_fk"
      FOREIGN KEY ("card_id") REFERENCES "public"."treatment_cards"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_top_ups_card_idx" ON "card_top_ups" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_top_ups_date_idx" ON "card_top_ups" USING btree ("payment_date");