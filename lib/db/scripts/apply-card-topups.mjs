import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the card top-up migration.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const client = await pool.connect();
try {
  const migration = await readFile(new URL("../drizzle/0002_card_topups.sql", import.meta.url), "utf8");
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:migrations', 0))");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:card-topups-schema', 0))");
  for (const statement of migration.split("--> statement-breakpoint").filter((part) => part.trim())) {
    await client.query(statement);
  }
  await client.query("COMMIT");
  console.log("Card top-up schema ready. Existing card and session data was preserved.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
