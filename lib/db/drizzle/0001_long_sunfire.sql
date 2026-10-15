ALTER TABLE "service_sessions" ADD COLUMN "customer_hourly_rate" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD COLUMN "customer_charge" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "service_types" ADD COLUMN "customer_hourly_rate" integer DEFAULT 0 NOT NULL;