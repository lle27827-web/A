import { createInsertSchema } from "drizzle-zod";
import { date, pgTable, serial, text, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const taskStatuses = ["todo", "in_progress", "done"] as const;
export const taskPriorities = ["low", "medium", "high"] as const;

export type TaskStatus = (typeof taskStatuses)[number];
export type TaskPriority = (typeof taskPriorities)[number];

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).$type<TaskStatus>().notNull().default("todo"),
  priority: varchar("priority", { length: 20 }).$type<TaskPriority>().notNull().default("medium"),
  dueDate: date("due_date", { mode: "string" }),
  isExample: boolean("is_example").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true,
  isExample: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
