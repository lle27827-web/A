import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the audit log migration.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const client = await pool.connect();
try {
  const migration = await readFile(new URL("../drizzle/0013_audit_logs.sql", import.meta.url), "utf8");
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:migrations', 0))");
  for (const statement of migration.split("--> statement-breakpoint").filter((part) => part.trim())) {
    await client.query(statement);
  }
  const result = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'audit_logs'
  `);
  const columns = new Map(result.rows.map((column) => [column.column_name, column]));
  const expected = [
    ["id", "uuid", "NO"],
    ["business_id", "text", "NO"],
    ["actor_email", "text", "YES"],
    ["action", "text", "NO"],
    ["entity", "text", "NO"],
    ["entity_id", "text", "NO"],
    ["before_json", "jsonb", "YES"],
    ["after_json", "jsonb", "YES"],
    ["created_at", "timestamp with time zone", "NO"],
  ];
  for (const [name, type, nullable] of expected) {
    const found = columns.get(name);
    if (!found || found.data_type !== type || found.is_nullable !== nullable) {
      throw new Error(`Existing audit log schema does not match expected column: ${name}`);
    }
  }
  await client.query("COMMIT");
  console.log("Append-only audit log schema ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
