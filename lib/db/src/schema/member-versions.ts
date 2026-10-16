import { boolean, index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { membersTable } from "./members";

export const memberVersionsTable = pgTable("member_versions", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => membersTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  hourlyRate: integer("hourly_rate").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  isBaseline: boolean("is_baseline").notNull().default(false),
}, (table) => [index("member_versions_member_date_idx").on(table.memberId, table.recordedAt)]);

export const insertMemberVersionSchema = createInsertSchema(memberVersionsTable).omit({ id: true });
export type InsertMemberVersion = z.infer<typeof insertMemberVersionSchema>;
