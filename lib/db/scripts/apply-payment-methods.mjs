import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the payment-method migration.");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15_000,
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:migrations', 0))");
  await client.query(`
    ALTER TABLE service_sessions
      ADD COLUMN IF NOT EXISTS payment_method text
  `);
  await client.query(`
    ALTER TABLE treatment_cards
      ADD COLUMN IF NOT EXISTS purchase_payment_method text,
      ADD COLUMN IF NOT EXISTS seller_name text
  `);
  await client.query(`
    ALTER TABLE card_top_ups
      ADD COLUMN IF NOT EXISTS payment_method text,
      ADD COLUMN IF NOT EXISTS seller_name text
  `);
  await client.query("COMMIT");
  console.log("Payment method and seller columns ready; existing transactions remain unclassified.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
