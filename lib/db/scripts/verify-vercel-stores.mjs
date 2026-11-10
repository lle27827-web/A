import pg from "pg";
import {
  resolveConfiguredStores,
} from "./vercel-stores.mjs";

const requiredTables = [
  "appointments",
  "employee_availability",
  "facility_bonus_settings",
  "facility_night_settings",
  "employee_service_bonus_rates",
  "attendance",
  "api_write_operations",
  "audit_logs",
  "card_top_ups",
  "card_usage_history",
  "manager_grants",
  "member_versions",
  "members",
  "personal_services",
  "personal_sessions",
  "personal_settings",
  "service_sessions",
  "service_types",
  "tasks",
  "treatment_cards",
];
const requiredGrantColumns = ["email", "permissions", "granted_by", "created_at"];
const requiredOperationColumns = [
  "operation_id",
  "request_hash",
  "result",
  "created_at",
];
const requiredPaymentColumns = {
  service_sessions: ["payment_method"],
  treatment_cards: ["purchase_payment_method", "seller_name"],
  card_top_ups: ["payment_method", "seller_name"],
};
const tenantTables = [
  "members",
  "member_versions",
  "attendance",
  "treatment_cards",
  "card_top_ups",
  "card_usage_history",
  "service_sessions",
  "service_types",
  "manager_grants",
  "appointments",
  "employee_availability",
  "facility_bonus_settings",
  "employee_service_bonus_rates",
  "facility_night_settings",
  "audit_logs",
];

async function verifyStore(store) {
  const client = new pg.Client({
    connectionString: store.url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 5_000,
  });
  try {
    await client.connect();
    const tables = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
         AND table_name = ANY($1::text[])`,
      [requiredTables],
    );
    const present = new Set(tables.rows.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !present.has(table));
    const requiredColumns = new Map();
    for (const [table, expected] of [
      ["manager_grants", requiredGrantColumns],
      ["api_write_operations", requiredOperationColumns],
      ["audit_logs", [
        "id",
        "business_id",
        "actor_email",
        "action",
        "entity",
        "entity_id",
        "before_json",
        "after_json",
        "created_at",
      ]],
      ...Object.entries(requiredPaymentColumns),
    ]) {
      requiredColumns.set(table, [
        ...new Set([...(requiredColumns.get(table) ?? []), ...expected]),
      ]);
    }
    for (const table of tenantTables) {
      requiredColumns.set(table, [
        ...new Set([...(requiredColumns.get(table) ?? []), "business_id"]),
      ]);
    }
    const columns = await client.query(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [[...requiredColumns.keys()]],
    );
    const columnsByName = new Map(
      columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]),
    );
    for (const [table, expectedColumns] of requiredColumns) {
      if (!present.has(table)) continue;
      for (const column of expectedColumns) {
        const found = columnsByName.get(`${table}.${column}`);
        if (!found) {
          missing.push(`${table}.${column}`);
        } else if (
          column === "business_id" &&
          (found.data_type !== "text" || found.is_nullable !== "NO")
        ) {
          missing.push(`${table}.${column} (expected NOT NULL text)`);
        }
      }
    }
    const indexes = await client.query(
      `SELECT tablename, indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])`,
      [tenantTables],
    );
    const indexDefinitions = new Map(
      indexes.rows.map((row) => [row.indexname, String(row.indexdef)]),
    );
    const missingIndexes = tenantTables
      .map((table) => `${table}_business_id_idx`)
      .filter((indexName) => !indexDefinitions.has(indexName));
    const scopedUniqueIndexes = [
      ["manager_grants_business_email_unique", /\(business_id, email\)/i],
      ["employee_service_bonus_rates_member_service_uidx", /\(business_id, member_id, service_type_id\)/i],
    ];
    for (const [indexName, columnsPattern] of scopedUniqueIndexes) {
      if (!columnsPattern.test(indexDefinitions.get(indexName) ?? "")) {
        missingIndexes.push(indexName);
      }
    }
    if (missingIndexes.length) {
      throw new Error(`${store.label} is missing required tenant-scoped indexes.`);
    }
    if (missing.length) {
      throw new Error(`${store.label} is missing required application schema items.`);
    }
    console.log(`${store.label}: required application schema verified.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function verifyBusinessRegistry(store) {
  const client = new pg.Client({
    connectionString: store.url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 5_000,
  });
  try {
    await client.connect();
    const tables = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
         AND table_name = ANY($1::text[])`,
      [["businesses", "business_users", "business_memberships", "business_join_attempts"]],
    );
    const present = new Set(tables.rows.map((row) => row.table_name));
    const missingTables = ["businesses", "business_users", "business_memberships", "business_join_attempts"].filter((table) => !present.has(table));
    if (missingTables.length) {
      throw new Error(`${store.label} is missing the business identity registry.`);
    }

    const columns = await client.query(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [["businesses", "business_users", "business_memberships", "business_join_attempts"]],
    );
    const presentColumns = new Map(
      columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]),
    );
    const missingColumns = [
      "businesses.id",
      "businesses.name",
      "businesses.owner_user_id",
      "businesses.owner_email",
      "businesses.join_code_hash",
      "businesses.active",
      "business_users.user_id",
      "business_users.email",
      "business_memberships.business_id",
      "business_memberships.user_id",
      "business_memberships.email",
      "business_memberships.role",
      "business_memberships.active",
      "business_join_attempts.id",
      "business_join_attempts.key_hash",
      "business_join_attempts.attempted_at",
    ].filter((column) => !presentColumns.has(column));
    if (missingColumns.length) {
      throw new Error(`${store.label} is missing required business identity columns.`);
    }

    const indexes = await client.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])`,
      [["businesses", "business_users", "business_memberships", "business_join_attempts"]],
    );
    const presentIndexes = new Set(indexes.rows.map((row) => row.indexname));
    const missingIndexes = [
      "businesses_join_code_hash_unique",
      "business_memberships_business_user_unique",
      "business_memberships_business_email_unique",
      "business_memberships_user_active_idx",
      "business_users_email_idx",
      "business_join_attempts_key_time_idx",
      "business_join_attempts_time_idx",
    ].filter((indexName) => !presentIndexes.has(indexName));
    if (missingIndexes.length) {
      throw new Error(`${store.label} is missing business join-attempt indexes.`);
    }

    const constraints = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'public.business_memberships'::regclass
         AND contype = 'f'`,
    );
    const definitions = new Map(constraints.rows.map((row) => [row.conname, row.definition]));
    const expectedConstraints = new Map([
      ["business_memberships_business_id_fkey", /FOREIGN KEY \(business_id\) REFERENCES businesses\(id\)/i],
      ["business_memberships_user_id_fkey", /FOREIGN KEY \(user_id\) REFERENCES business_users\(user_id\)/i],
    ]);
    const missingConstraints = [...expectedConstraints].filter(([name, pattern]) =>
      !pattern.test(String(definitions.get(name) ?? "")),
    );
    if (missingConstraints.length) {
      throw new Error(`${store.label} is missing the business membership foreign keys.`);
    }
    console.log(`${store.label}: business users and membership relationships verified.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

const stores = resolveConfiguredStores(process.env);
for (const store of stores) {
  await verifyStore(store);
  if (store.backend === "database_url_4") await verifyBusinessRegistry(store);
}
