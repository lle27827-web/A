import { check, date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { treatmentCardsTable } from "./treatment-cards";

export const cardTopUpsTable = pgTable("card_top_ups", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id").notNull().references(() => treatmentCardsTable.id, { onDelete: "cascade" }),
  minutes: integer("minutes").notNull(),
  amount: integer("amount").notNull(),
  paymentDate: date("payment_date", { mode: "string" }).notNull(),
  source: text("source").notNull().default("topup"),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("card_top_ups_card_idx").on(table.cardId),
  index("card_top_ups_date_idx").on(table.paymentDate),
  check("card_top_ups_minutes_positive", sql`${table.minutes} > 0 or (${table.minutes} = 0 and ${table.source} = 'merged_card')`),
  check("card_top_ups_amount_nonnegative", sql`${table.amount} >= 0`),
]);

export type CardTopUpRow = typeof cardTopUpsTable.$inferSelect;
