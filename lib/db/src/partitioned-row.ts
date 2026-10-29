/**
 * node-postgres returns result column labels verbatim (snake_case), unlike
 * Drizzle's select rows which expose camelCase property names.
 */
export function normalizePartitionDatabaseRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}

export function personalTableReadPredicates(tableName: string): {
  eventSql: string;
  baseSql: string;
} {
  if (!["personal_services", "personal_sessions", "personal_settings"].includes(tableName)) {
    throw new Error("User filters are supported only for personal notebook tables.");
  }
  return {
    eventSql: `AND entity_key IN (SELECT entity_key FROM public.storage_partition_events
      WHERE committed = true AND entity_type = $1 AND payload->>'userId' = $2)`,
    baseSql: "WHERE user_id = $1",
  };
}
