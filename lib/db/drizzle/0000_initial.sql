CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'todo' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"due_date" date,
	"is_example" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"hourly_rate" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer,
	"employee_name" varchar(120) NOT NULL,
	"work_date" date NOT NULL,
	"check_in" varchar(5),
	"check_out" varchar(5),
	"status" varchar(16) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"service_type" text NOT NULL,
	"total_minutes" integer NOT NULL,
	"purchase_amount" integer NOT NULL,
	"purchase_date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer,
	"member_id" integer,
	"employee_name" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"service_type" text NOT NULL,
	"service_type_id" integer,
	"work_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"hourly_rate" integer NOT NULL,
	"earnings" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"hourly_rate" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_card_id_treatment_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."treatment_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "treatment_cards_purchase_date_idx" ON "treatment_cards" USING btree ("purchase_date");--> statement-breakpoint
CREATE INDEX "service_sessions_member_date_idx" ON "service_sessions" USING btree ("member_id","work_date");--> statement-breakpoint
CREATE INDEX "service_sessions_card_idx" ON "service_sessions" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "service_sessions_service_type_idx" ON "service_sessions" USING btree ("service_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manager_grants_email_unique" ON "manager_grants" USING btree ("email");