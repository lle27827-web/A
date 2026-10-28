import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const apiWriteOperationsTable = pgTable("api_write_operations", {
  operationId: uuid("operation_id").primaryKey(),
  requestHash: text("request_hash").notNull(),
  result: jsonb("result").$type<{ value: unknown }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
