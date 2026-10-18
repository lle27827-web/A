import { date, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { treatmentCardsTable } from "./treatment-cards";

/**
 * Permanent card-use ledger. Employee service-session rows older than the
 * retention window are copied here before they are removed from payroll/history.
 */
export const cardUsageHistoryTable = pgTable("card_usage_history", {
  sourceSessionId: integer("source_session_id").primaryKey(),
  cardId: integer("card_id").notNull().references(() => treatmentCardsTable.id, { onDelete: "restrict" }),
  memberId: integer("member_id"),
  employeeName: text("employee_name").notNull(),
  customerName: text("customer_name").notNull().default(""),
  serviceType: text("service_type").notNull(),
  serviceTypeId: integer("service_type_id"),
  workDate: date("work_date", { mode: "string" }).notNull(),
  minutes: integer("minutes").notNull(),
  customerHourlyRate: integer("customer_hourly_rate").notNull().default(0),
  customerCharge: integer("customer_charge").notNull().default(0),
  hourlyRate: integer("hourly_rate").notNull(),
  earnings: integer("earnings").notNull(),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("card_usage_history_card_date_idx").on(table.cardId, table.workDate),
  index("card_usage_history_date_idx").on(table.workDate),
]);

export type CardUsageHistoryRow = typeof cardUsageHistoryTable.$inferSelect;
