import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const serviceTypesTable = pgTable("service_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  customerHourlyRate: integer("customer_hourly_rate").notNull().default(0),
  hourlyRate: integer("hourly_rate").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertServiceTypeSchema = createInsertSchema(serviceTypesTable).omit({ id: true, createdAt: true });
export type InsertServiceType = z.infer<typeof insertServiceTypeSchema>;
export type ServiceType = typeof serviceTypesTable.$inferSelect;
