import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const treatmentCardsTable = pgTable("treatment_cards", {
  id: serial("id").primaryKey(),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  serviceType: text("service_type").notNull(),
  totalMinutes: integer("total_minutes").notNull(),
  purchaseAmount: integer("purchase_amount").notNull(),
  purchaseDate: date("purchase_date", { mode: "string" }).notNull(),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  firstUsedAt: timestamp("first_used_at", { withTimezone: true }),
}, (table) => [index("treatment_cards_purchase_date_idx").on(table.purchaseDate)]);

export const insertTreatmentCardSchema = createInsertSchema(treatmentCardsTable).omit({ id: true, createdAt: true, deletedAt: true, firstUsedAt: true });
export type InsertTreatmentCard = z.infer<typeof insertTreatmentCardSchema>;
export type TreatmentCardRow = typeof treatmentCardsTable.$inferSelect;
