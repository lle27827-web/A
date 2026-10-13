import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { membersTable } from "./members";
import { treatmentCardsTable } from "./treatment-cards";

// Card history and employee payroll share a single service-visit record.
export const serviceSessionsTable = pgTable("service_sessions", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id").references(() => treatmentCardsTable.id, { onDelete: "restrict" }),
  memberId: integer("member_id").references(() => membersTable.id, { onDelete: "set null" }),
  employeeName: text("employee_name").notNull(),
  customerName: text("customer_name").notNull().default(""),
  serviceType: text("service_type").notNull(),
  workDate: date("work_date", { mode: "string" }).notNull(),
  minutes: integer("minutes").notNull(),
  hourlyRate: integer("hourly_rate").notNull(),
  earnings: integer("earnings").notNull(),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("service_sessions_member_date_idx").on(table.memberId, table.workDate),
  index("service_sessions_card_idx").on(table.cardId),
]);

export const insertServiceSessionSchema = createInsertSchema(serviceSessionsTable).omit({ id: true, createdAt: true });
export type InsertServiceSession = z.infer<typeof insertServiceSessionSchema>;
export type ServiceSessionRow = typeof serviceSessionsTable.$inferSelect;
