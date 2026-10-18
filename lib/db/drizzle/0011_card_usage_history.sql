CREATE TABLE "card_usage_history" (
	"source_session_id" integer PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"member_id" integer,
	"employee_name" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"service_type" text NOT NULL,
	"service_type_id" integer,
	"work_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"customer_hourly_rate" integer DEFAULT 0 NOT NULL,
	"customer_charge" integer DEFAULT 0 NOT NULL,
	"hourly_rate" integer NOT NULL,
	"earnings" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_usage_history" ADD CONSTRAINT "card_usage_history_card_id_treatment_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."treatment_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_usage_history_card_date_idx" ON "card_usage_history" USING btree ("card_id","work_date");--> statement-breakpoint
CREATE INDEX "card_usage_history_date_idx" ON "card_usage_history" USING btree ("work_date");