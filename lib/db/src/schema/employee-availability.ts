import { date, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const employeeAvailabilityTable = pgTable("employee_availability", {
  memberId: integer("member_id").primaryKey(),
  employeeName: text("employee_name").notNull(),
  statusDate: date("status_date", { mode: "string" }).notNull(),
  state: text("state").$type<"off">().notNull().default("off"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("employee_availability_status_date_idx").on(table.statusDate)]);

export type EmployeeAvailability = typeof employeeAvailabilityTable.$inferSelect;
