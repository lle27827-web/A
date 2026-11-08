import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const treatmentCardsTable = pgTable("treatment_cards", {
  id: serial("id").primaryKey(),
  businessId: text("business_id").notNull().default("00000000-0000-4000-8000-000000000001"),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  serviceType: text("service_type").notNull(),
  totalMinutes: integer("total_minutes").notNull(),
  purchaseAmount: integer("purchase_amount").notNull(),
  purchaseDate: date("purchase_date", { mode: "string" }).notNull(),
  purchasePaymentMethod: text("purchase_payment_method"),
  sellerName: text("seller_name"),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  firstUsedAt: timestamp("first_used_at", { withTimezone: true }),
}, (table) => [index("treatment_cards_purchase_date_idx").on(table.purchaseDate)]);

export const insertTreatmentCardSchema = createInsertSchema(treatmentCardsTable).omit({ id: true, createdAt: true, deletedAt: true, firstUsedAt: true });
export type InsertTreatmentCard = z.infer<typeof insertTreatmentCardSchema>;
export type TreatmentCardRow = typeof treatmentCardsTable.$inferSelect;
