import { jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const managerGrantsTable = pgTable("manager_grants", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  permissions: jsonb("permissions").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("manager_grants_email_unique").on(table.email)]);

export const insertManagerGrantSchema = createInsertSchema(managerGrantsTable).omit({ id: true, createdAt: true });
export type InsertManagerGrant = z.infer<typeof insertManagerGrantSchema>;
