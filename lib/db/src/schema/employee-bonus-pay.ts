import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const facilityBonusSettingsTable = pgTable("facility_bonus_settings", {
  id: integer("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(false),
  thresholdMinutes: integer("threshold_minutes").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("facility_bonus_settings_singleton", sql`${table.id} = 1`),
  check("facility_bonus_settings_threshold_bounds", sql`${table.thresholdMinutes} between 0 and 44640`),
]);

export const employeeServiceBonusRatesTable = pgTable("employee_service_bonus_rates", {
  id: text("id").primaryKey(),
  memberId: integer("member_id").notNull(),
  serviceTypeId: integer("service_type_id").notNull(),
  hourlyRate: integer("hourly_rate").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("employee_service_bonus_rates_member_service_uidx").on(table.memberId, table.serviceTypeId),
  index("employee_service_bonus_rates_member_idx").on(table.memberId),
  check("employee_service_bonus_rates_rate_bounds", sql`${table.hourlyRate} between 1 and 10000000`),
]);

export function employeeBonusRateKey(memberId: number, serviceTypeId: number) {
  return `${memberId}:${serviceTypeId}`;
}
