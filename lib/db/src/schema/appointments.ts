import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const appointmentsTable = pgTable("appointments", {
  id: serial("id").primaryKey(),
  businessId: text("business_id").notNull().default("00000000-0000-4000-8000-000000000001"),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  memberId: integer("member_id"),
  status: text("status").notNull().default("scheduled"),
  request: text("request").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("appointments_scheduled_at_idx").on(table.scheduledAt)]);

export const insertAppointmentSchema = createInsertSchema(appointmentsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
