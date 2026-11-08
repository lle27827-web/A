import pg from "pg";
import {
  resolveConfiguredStores,
  resolveFailoverCoordinatorUrl,
} from "./vercel-stores.mjs";

const requiredTables = [
  "appointments",
  "employee_availability",
  "facility_bonus_settings",
  "facility_night_settings",
  "employee_service_bonus_rates",
  "attendance",
  "api_write_operations",
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
    for (const [table, expectedColumns] of [
      ["manager_grants", requiredGrantColumns],
      ["api_write_operations", requiredOperationColumns],
      ...Object.entries(requiredPaymentColumns),
    ]) {
      if (!present.has(table)) continue;
      const columns = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      const names = new Set(columns.rows.map((row) => row.column_name));
      for (const column of expectedColumns) {
        if (!names.has(column)) missing.push(`${table}.${column}`);
      }
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
      [["businesses", "business_users", "business_memberships"]],
    );
    const present = new Set(tables.rows.map((row) => row.table_name));
    const missingTables = ["businesses", "business_users", "business_memberships"].filter((table) => !present.has(table));
    if (missingTables.length) {
      throw new Error(`${store.label} is missing the business identity registry.`);
    }

    const columns = await client.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [["business_users", "business_memberships"]],
    );
    const presentColumns = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missingColumns = [
      "business_users.user_id",
      "business_users.email",
      "business_memberships.business_id",
      "business_memberships.user_id",
    ].filter((column) => !presentColumns.has(column));
    if (missingColumns.length) {
      throw new Error(`${store.label} is missing required business identity columns.`);
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

async function verifyFailoverState(url) {
  if (!url) return;
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 5_000,
  });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT active_backend, switch_started_at, switch_source_backend,
             switch_target_backend, manual_recovery_required
      FROM public.db_failover_state
      WHERE id = 1
    `);
    const state = result.rows[0];
    if (!state) throw new Error("Failover coordinator state row is missing.");
    if (state.active_backend === "switching") {
      throw new Error("Failover coordinator is in switching state; resolve it before deployment.");
    }
    if (state.manual_recovery_required) {
      throw new Error("Failover coordinator requires owner recovery before deployment.");
    }
    console.log("Failover state schema and active row verified.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

const stores = resolveConfiguredStores(process.env);
for (const store of stores) {
  await verifyStore(store);
  if (store.backend === "database_url_4") await verifyBusinessRegistry(store);
}
await verifyFailoverState(resolveFailoverCoordinatorUrl(process.env, stores));
