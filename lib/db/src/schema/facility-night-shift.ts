import { boolean, check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const facilityNightSettingsTable = pgTable("facility_night_settings", {
  id: integer("id").notNull().default(1),
  businessId: text("business_id").notNull().default("00000000-0000-4000-8000-000000000001"),
  enabled: boolean("enabled").notNull().default(false),
  startTime: text("start_time").notNull().default("22:00"),
  endTime: text("end_time").notNull().default("06:00"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  check("facility_night_settings_singleton", sql`${table.id} = 1`),
  check("facility_night_settings_time_format", sql`
    ${table.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and ${table.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and ${table.startTime} <> ${table.endTime}
  `),
]);

export const insertFacilityNightSettingsSchema = createInsertSchema(facilityNightSettingsTable).omit({ updatedAt: true });
export type InsertFacilityNightSettings = z.infer<typeof insertFacilityNightSettingsSchema>;
export type FacilityNightSettings = typeof facilityNightSettingsTable.$inferSelect;
