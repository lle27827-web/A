import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Control-plane cursor. This table belongs on the chosen coordinator only.
 * It is deliberately separate from the application tables and is not subject
 * to logical replication.
 */
export const storagePartitionStateTable = pgTable("storage_partition_state", {
  id: smallint("id").primaryKey(),
  writeBackend: text("write_backend").notNull(),
  nextRevision: bigint("next_revision", { mode: "bigint" }).notNull().default(1n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("storage_partition_state_singleton_check", sql`${table.id} = 1`),
  check(
    "storage_partition_state_backend_check",
    sql`${table.writeBackend} IN ('database_url_1', 'database_url', 'database_url_3', 'database_url_4')`,
  ),
]);

/**
 * Append-only changes are stored on the shard that accepted the write.
 * entityKey is globally qualified (for example, "database_url_1:123") so
 * local serial IDs from different databases cannot be mistaken for each other.
 */
export const storagePartitionEventsTable = pgTable("storage_partition_events", {
  eventId: uuid("event_id").primaryKey(),
  operationId: uuid("operation_id").notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull(),
  sourceBackend: text("source_backend").notNull(),
  entityType: text("entity_type").notNull(),
  entityKey: text("entity_key").notNull(),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("storage_partition_events_entity_revision_unique")
    .on(table.entityType, table.entityKey, table.revision),
  index("storage_partition_events_operation_idx").on(table.operationId),
  index("storage_partition_events_entity_idx").on(table.entityType, table.entityKey, table.revision),
  check(
    "storage_partition_events_action_check",
    sql`${table.action} IN ('upsert', 'delete')`,
  ),
  check(
    "storage_partition_events_source_backend_check",
    sql`${table.sourceBackend} IN ('database_url_1', 'database_url', 'database_url_3', 'database_url_4')`,
  ),
  check(
    "storage_partition_events_payload_check",
    sql`(${table.action} = 'delete' AND ${table.payload} IS NULL) OR (${table.action} = 'upsert' AND ${table.payload} IS NOT NULL)`,
  ),
]);

/**
 * A cross-shard command can have more than one local commit. Persist the
 * operation state on the coordinator so retries can resume instead of
 * replaying an ambiguous write.
 */
export const storagePartitionOperationsTable = pgTable("storage_partition_operations", {
  operationId: uuid("operation_id").primaryKey(),
  targetBackend: text("target_backend").notNull(),
  state: text("state").notNull(),
  requestHash: text("request_hash").notNull(),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "storage_partition_operations_backend_check",
    sql`${table.targetBackend} IN ('database_url_1', 'database_url', 'database_url_3', 'database_url_4')`,
  ),
  check(
    "storage_partition_operations_state_check",
    sql`${table.state} IN ('pending', 'committed', 'needs_reconciliation')`,
  ),
  index("storage_partition_operations_state_idx").on(table.state, table.updatedAt),
]);
