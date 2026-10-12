import { createInsertSchema } from "drizzle-zod";
import { date, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const attendanceStatuses = ["present", "late", "absent", "leave"] as const;

export type AttendanceStatus = (typeof attendanceStatuses)[number];

export const attendanceTable = pgTable("attendance", {
  id: serial("id").primaryKey(),
  employeeName: varchar("employee_name", { length: 120 }).notNull(),
  workDate: date("work_date", { mode: "string" }).notNull(),
  checkIn: varchar("check_in", { length: 5 }),
  checkOut: varchar("check_out", { length: 5 }),
  status: varchar("status", { length: 16 }).$type<AttendanceStatus>().notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
