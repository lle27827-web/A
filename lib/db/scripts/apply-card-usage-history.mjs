import { readFile } from "node:fs/promises";
import pg from "pg";

const sourceUrl = process.env.DATABASE_URL?.trim();
const primaryUrl = process.env.VERCEL === "1"
  ? (process.env.NEON_DB1_DIRECT_URL?.trim() || process.env.DATABASE_URL_1?.trim())
  : undefined;
const targets = [...new Set([sourceUrl, primaryUrl].filter((url) => Boolean(url)))];
if (!targets.length) throw new Error("DATABASE_URL is required for the card usage history migration.");

const migration = await readFile(new URL("../drizzle/0011_card_usage_history.sql", import.meta.url), "utf8");
for (const [index, connectionString] of targets.entries()) {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 15000, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL search_path = public, pg_catalog");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:migrations', 0))");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:card-usage-history-schema', 0))");
    const tableExists = await client.query("SELECT to_regclass('public.card_usage_history') IS NOT NULL AS exists");
    if (!tableExists.rows[0].exists) {
      for (const statement of migration.split("--> statement-breakpoint").filter((part) => part.trim())) {
        await client.query(statement);
      }
    }

    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'card_usage_history'
    `);
    const actual = new Map(result.rows.map((column) => [column.column_name, column]));
    const expected = [
      ["source_session_id", "integer", "NO"],
      ["card_id", "integer", "NO"],
      ["member_id", "integer", "YES"],
      ["employee_name", "text", "NO"],
      ["customer_name", "text", "NO"],
      ["service_type", "text", "NO"],
      ["service_type_id", "integer", "YES"],
      ["work_date", "date", "NO"],
      ["minutes", "integer", "NO"],
      ["customer_hourly_rate", "integer", "NO"],
      ["customer_charge", "integer", "NO"],
      ["hourly_rate", "integer", "NO"],
      ["earnings", "integer", "NO"],
      ["note", "text", "NO"],
      ["created_at", "timestamp with time zone", "NO"],
    ];
    for (const [name, type, nullable] of expected) {
      const column = actual.get(name);
      if (!column || column.data_type !== type || column.is_nullable !== nullable) {
        throw new Error(`Card usage history schema does not match expected column: ${name}`);
      }
    }
    const constraints = await client.query(`
      SELECT conname, contype, confdeltype, convalidated
      FROM pg_constraint
      WHERE conrelid = 'public.card_usage_history'::regclass
    `);
    if (!constraints.rows.some((constraint) => constraint.contype === "p" && constraint.conname === "card_usage_history_pkey")) {
      throw new Error("Card usage history primary key is missing.");
    }
    if (!constraints.rows.some((constraint) => constraint.contype === "f"
      && constraint.conname === "card_usage_history_card_id_treatment_cards_id_fk"
      && constraint.confdeltype === "r" && constraint.convalidated)) {
      throw new Error("Card usage history card-reference restriction is missing.");
    }
    const indexes = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'card_usage_history'
    `);
    for (const name of ["card_usage_history_card_date_idx", "card_usage_history_date_idx"]) {
      if (!indexes.rows.some((index) => index.indexname === name)) {
        throw new Error(`Card usage history index is missing: ${name}`);
      }
    }
    await client.query("COMMIT");
    console.log(`Card usage history schema ready on database target ${index + 1}.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
