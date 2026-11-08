import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const serviceTypesTable = pgTable("service_types", {
  id: serial("id").primaryKey(),
  businessId: text("business_id").notNull().default("00000000-0000-4000-8000-000000000001"),
  name: text("name").notNull(),
  customerHourlyRate: integer("customer_hourly_rate").notNull().default(0),
  hourlyRate: integer("hourly_rate").notNull(),
  nightCustomerHourlyRate: integer("night_customer_hourly_rate"),
  nightHourlyRate: integer("night_hourly_rate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertServiceTypeSchema = createInsertSchema(serviceTypesTable).omit({ id: true, createdAt: true });
export type InsertServiceType = z.infer<typeof insertServiceTypeSchema>;
export type ServiceType = typeof serviceTypesTable.$inferSelect;
