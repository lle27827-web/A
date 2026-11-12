export function mapBackendValues(value) {
  if (value === "database_url_4") return "database_url_3";
  if (Array.isArray(value)) return value.map(mapBackendValues);
  if (!value || typeof value !== "object" || value instanceof Date) return value;

  const mapped = Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      mapBackendValues(childValue),
    ]),
  );
  if (mapped.primary && mapped.primary === mapped.replica) {
    mapped.replica = "database_url_1";
  }
  if (
    mapped.targetBackend &&
    mapped.targetBackend === mapped.replicaBackend
  ) {
    mapped.replicaBackend = "database_url_1";
  }
  return mapped;
}

export function transformRow(table, sourceRow) {
  const row = { ...sourceRow };
  if (table === "storage_partition_state" && row.write_backend === "database_url_4") {
    row.write_backend = "database_url_3";
  }
  if (table === "storage_partition_operations") {
    if (row.target_backend === "database_url_4") row.target_backend = "database_url_3";
    if (row.result && typeof row.result === "object") {
      row.result = mapBackendValues(row.result);
      if (row.result.replicaBackend === row.target_backend) {
        row.result.replicaBackend = "database_url_1";
      }
    }
  }
  if (table === "db_failover_state") {
    for (const column of ["active_backend", "switch_source_backend", "switch_target_backend"]) {
      if (row[column] === "database_url_4") row[column] = "database_url_3";
    }
    if (row.active_backend === "switching") {
      throw new Error("DB4 failover is in a switching state; resolve it before migration.");
    }
  }
  return row;
}

export function rowsEquivalent(table, sourceRow, targetRow) {
  const ignoredColumns =
    table === "facility_night_settings" ? new Set(["updated_at"]) : new Set();
  const normalize = (value) => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !ignoredColumns.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  return JSON.stringify(normalize(sourceRow)) === JSON.stringify(normalize(targetRow));
}
