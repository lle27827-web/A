import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const facilityBonusSettingsTable = pgTable("facility_bonus_settings", {
  id: integer("id").notNull().default(1),
  businessId: text("business_id").notNull().default("00000000-0000-4000-8000-000000000001"),
  enabled: boolean("enabled").notNull().default(false),
  thresholdMinutes: integer("threshold_minutes").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  check("facility_bonus_settings_singleton", sql`${table.id} = 1`),
  check("facility_bonus_settings_threshold_bounds", sql`${table.thresholdMinutes} between 0 and 44640`),
]);

export const employeeServiceBonusRatesTable = pgTable("employee_service_bonus_rates", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().default("00000000-0000-4000-8000-000000000001"),
  memberId: integer("member_id").notNull(),
  serviceTypeId: integer("service_type_id").notNull(),
  hourlyRate: integer("hourly_rate").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("employee_service_bonus_rates_member_service_uidx").on(table.businessId, table.memberId, table.serviceTypeId),
  index("employee_service_bonus_rates_member_idx").on(table.memberId),
  check("employee_service_bonus_rates_rate_bounds", sql`${table.hourlyRate} between 1 and 10000000`),
]);

export const DEFAULT_BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

export function employeeBonusRateKey(
  memberId: number,
  serviceTypeId: number,
  businessId = DEFAULT_BUSINESS_ID,
) {
  // Preserve the legacy key for the migrated default business. Other businesses
  // share the same ID ranges, so their primary keys must include the tenant ID.
  return businessId === DEFAULT_BUSINESS_ID
    ? `${memberId}:${serviceTypeId}`
    : `${businessId}:${memberId}:${serviceTypeId}`;
}
