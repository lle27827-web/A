import { bigint, boolean, check, date, foreignKey, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const personalServicesTable = pgTable("personal_services", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  hourlyRate: integer("hourly_rate").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  facilityServiceId: integer("facility_service_id"),
}, (table) => [
  unique("personal_services_id_user_unique").on(table.id, table.userId),
  unique("personal_services_facility_user_unique").on(table.userId, table.facilityServiceId),
  index("personal_services_user_idx").on(table.userId),
  check("personal_services_rate_bounds", sql`${table.hourlyRate} between 0 and 100000000`),
]);

export const personalSessionsTable = pgTable("personal_sessions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  serviceId: integer("service_id").notNull(),
  serviceName: text("service_name").notNull(),
  workDate: date("work_date", { mode: "string" }).notNull(),
  minutes: integer("minutes").notNull(),
  hourlyRate: integer("hourly_rate").notNull(),
  earnings: bigint("earnings", { mode: "number" }).notNull(),
  note: text("note").default("").notNull(),
  customerName: text("customer_name").default("").notNull(),
  requestId: text("request_id"),
  sourceSessionId: integer("source_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    name: "personal_sessions_service_user_fk",
    columns: [table.serviceId, table.userId],
    foreignColumns: [personalServicesTable.id, personalServicesTable.userId],
  }).onDelete("restrict"),
  index("personal_sessions_user_date_idx").on(table.userId, table.workDate),
  unique("personal_sessions_request_user_unique").on(table.userId, table.requestId),
  check("personal_sessions_minutes_bounds", sql`${table.minutes} between 1 and 1440`),
  check("personal_sessions_rate_bounds", sql`${table.hourlyRate} between 0 and 100000000`),
  check("personal_sessions_earnings_nonnegative", sql`${table.earnings} >= 0`),
]);

export const personalSettingsTable = pgTable("personal_settings", {
  userId: text("user_id").primaryKey(),
  useFacilityRates: boolean("use_facility_rates").default(false).notNull(),
});
