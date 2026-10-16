import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:migrations', 0))");
  const text = await readFile(new URL("../drizzle/0006_card_merge_personal_sync.sql", import.meta.url), "utf8");
  for (const statement of text.split("--> statement-breakpoint").filter((part) => part.trim())) await client.query(statement);
  await client.query("COMMIT");
  console.log("Card merge and personal sync schema ready. Existing records preserved.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
