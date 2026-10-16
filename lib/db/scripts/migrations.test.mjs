import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { applySql, quoteIdentifier as q, readCatalog } from "./migration-catalog.mjs";
import { loadMigrations, runMigrations } from "./migrations.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for isolated development integration tests.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const migrations = await loadMigrations();
after(() => pool.end());

async function fixture(body) {
  const client = await pool.connect();
  const schema = `migration_test_${randomUUID().replaceAll("-", "")}`;
  const journalSchema = `${schema}_journal`;
  const options = { schema, journalSchema, migrations };
  await client.query(`CREATE SCHEMA ${q(schema)}`);
  try {
    await body(client, options);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${q(schema)} CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS ${q(journalSchema)} CASCADE`);
    client.release();
  }
}

async function seed(client, options, through = 4) {
  await client.query("BEGIN");
  try {
    for (const migration of migrations.slice(0, through + 1)) {
      await applySql(client, migration.sql, options.schema);
      if (migration.idx === 0) {
        await client.query(`INSERT INTO tasks (title) VALUES ('migration fixture');
          INSERT INTO members (name,hourly_rate) VALUES ('fixture technician',60000);
          INSERT INTO service_types (name,hourly_rate) VALUES ('fixture service',60000);
          INSERT INTO treatment_cards (customer_name,phone,service_type,total_minutes,purchase_amount,purchase_date)
            VALUES ('fixture customer','000000','fixture service',120,300000,'2090-01-01');
          INSERT INTO service_sessions (card_id,member_id,employee_name,service_type,service_type_id,
            work_date,minutes,hourly_rate,earnings)
            VALUES (1,1,'fixture technician','fixture service',1,'2090-01-02',30,60000,30000)`);
      }
      if (migration.idx === 2) {
        await client.query(`INSERT INTO card_top_ups (card_id,minutes,amount,payment_date)
          VALUES (1,60,150000,'2090-01-03');
          UPDATE treatment_cards SET total_minutes=total_minutes+60 WHERE id=1`);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function ledgerCount(client, options) {
  const table = `${q(options.journalSchema)}."__drizzle_migrations"`;
  const exists = (await client.query("SELECT to_regclass($1) IS NOT NULL AS found", [table])).rows[0].found;
  return exists ? Number((await client.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count) : 0;
}

async function digest(client, schema) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename", [schema])).rows;
  const result = {};
  for (const { tablename } of tables) {
    // Compare contents without logging or exporting any customer data.
    result[tablename] = (await client.query(`SELECT md5(coalesce(
      jsonb_agg(to_jsonb(t) ORDER BY id)::text, '[]')) AS digest
      FROM ${q(schema)}.${q(tablename)} t`)).rows[0].digest;
  }
  return result;
}

test("populated schema audits exactly, baseline changes only journal and is Drizzle-compatible", async () => {
  const guard = await pool.connect();
  const publicBefore = await digest(guard, "public");
  guard.release();
  await fixture(async (client, options) => {
    await seed(client, options);
    const before = await digest(client, options.schema);
    await assert.rejects(runMigrations(client, options), /no migration baseline/);
    assert.equal(await ledgerCount(client, options), 0);
    const audit = await runMigrations(client, { ...options, mode: "audit" });
    assert.equal(audit.equivalentThrough, "0004_card_usage_lock");
    assert.deepEqual(audit.differences, []);
    assert.equal(await ledgerCount(client, options), 0, "audit must not create history");
    const baseline = await runMigrations(client, { ...options, mode: "baseline" });
    assert.equal(baseline.recorded.length, 5);
    assert.deepEqual(baseline.applied, [], "baseline never replays application SQL");
    assert.deepEqual(await digest(client, options.schema), before);
    assert.deepEqual((await runMigrations(client, options)).applied, []);
    assert.deepEqual((await runMigrations(client, { ...options, mode: "baseline" })).recorded, []);
    // All migrations are already journaled: native Drizzle must also perform no DDL.
    await migrate(drizzle(client), {
      migrationsFolder: new URL("../drizzle/", import.meta.url).pathname,
      migrationsSchema: options.journalSchema,
    });
    assert.equal(await ledgerCount(client, options), 5);
    assert.deepEqual(await digest(client, options.schema), before);
  });
  const check = await pool.connect();
  assert.deepEqual(await digest(check, "public"), publicBefore, "isolated tests/reference SQL must not touch live application rows");
  check.release();
});

test("new database initializes once, includes backfills, and reruns cleanly", async () => {
  await fixture(async (client, options) => {
    assert.equal((await runMigrations(client, options)).applied.length, 5);
    assert.equal(await ledgerCount(client, options), 5);
    const audit = await runMigrations(client, { ...options, mode: "audit" });
    assert.equal(audit.equivalentThrough, "0004_card_usage_lock");
    assert.deepEqual(audit.differences, []);
    assert.deepEqual((await runMigrations(client, options)).applied, []);
  });
});

test("each verified historical prefix upgrades without recreating populated tables", async () => {
  for (const through of [0, 1, 2, 3]) {
    await fixture(async (client, options) => {
      await seed(client, options, through);
      const memberBefore = (await client.query(`SELECT * FROM ${q(options.schema)}.members`)).rows[0];
      const baseline = await runMigrations(client, { ...options, mode: "baseline" });
      assert.equal(baseline.recorded.length, through + 1);
      const result = await runMigrations(client, options);
      assert.equal(result.applied.length, 4 - through);
      const memberAfter = (await client.query(`SELECT * FROM ${q(options.schema)}.members`)).rows[0];
      for (const key of Object.keys(memberBefore)) assert.deepEqual(memberAfter[key], memberBefore[key]);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${q(options.schema)}.tasks`)).rows[0].n, 1);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${q(options.schema)}.service_sessions`)).rows[0].n, 1);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${q(options.schema)}.member_versions`)).rows[0].n, 1);
      assert.ok((await client.query(`SELECT first_used_at FROM ${q(options.schema)}.treatment_cards WHERE id=1`)).rows[0].first_used_at);
      assert.equal((await runMigrations(client, { ...options, mode: "audit" })).equivalentThrough, "0004_card_usage_lock");
    });
  }
});

test("schema mismatches are refused without registering false history", async () => {
  const changes = [
    `ALTER TABLE members ALTER COLUMN hourly_rate SET DEFAULT 99`,
    `ALTER TABLE members ALTER COLUMN name TYPE varchar(200)`,
    `ALTER TABLE members ALTER COLUMN name DROP NOT NULL`,
    `ALTER TABLE service_sessions DROP CONSTRAINT service_sessions_card_id_treatment_cards_id_fk`,
    `DROP INDEX manager_grants_email_unique`,
    `ALTER TABLE card_top_ups DROP CONSTRAINT card_top_ups_minutes_positive`,
    `ALTER TABLE members ENABLE ROW LEVEL SECURITY`,
    `ALTER SEQUENCE members_id_seq INCREMENT BY 2`,
  ];
  for (const change of changes) {
    await fixture(async (client, options) => {
      await seed(client, options);
      await client.query("BEGIN");
      await applySql(client, change, options.schema);
      await client.query("COMMIT");
      const before = await digest(client, options.schema);
      const audit = await runMigrations(client, { ...options, mode: "audit" });
      assert.equal(audit.equivalentThrough, null);
      assert.ok(audit.differences.length);
      await assert.rejects(runMigrations(client, { ...options, mode: "baseline" }), /baseline refused/);
      assert.equal(await ledgerCount(client, options), 0);
      assert.deepEqual(await digest(client, options.schema), before);
    });
  }
});

test("partial pricing schema and missing data backfills cannot be silently baselined", async () => {
  await fixture(async (client, options) => {
    await seed(client, options, 0);
    await client.query(`ALTER TABLE ${q(options.schema)}.service_types ADD COLUMN customer_hourly_rate integer DEFAULT 0 NOT NULL`);
    await assert.rejects(runMigrations(client, { ...options, mode: "baseline" }), /baseline refused/);
    assert.equal(await ledgerCount(client, options), 0);
  });
  for (const sql of ["DELETE FROM member_versions", "UPDATE treatment_cards SET first_used_at=NULL"]) {
    await fixture(async (client, options) => {
      await seed(client, options);
      await client.query("BEGIN");
      await applySql(client, sql, options.schema);
      await client.query("COMMIT");
      await assert.rejects(runMigrations(client, { ...options, mode: "baseline" }), /backfill is incomplete/);
      assert.equal(await ledgerCount(client, options), 0);
    });
  }
});

function future(index, sql) {
  return { idx: index, tag: `000${index}_fixture`, when: migrations.at(-1).when + index,
    sql, hash: createHash("sha256").update(sql).digest("hex") };
}

test("append-only upgrades are atomic, idempotent, and reject altered or gapped journal rows", async () => {
  await fixture(async (client, options) => {
    await runMigrations(client, options);
    const probe = future(5, 'ALTER TABLE "tasks" ADD COLUMN "migration_probe" integer DEFAULT 7 NOT NULL;');
    const failure = future(6, "SELECT deliberately_missing_migration_function();");
    await assert.rejects(runMigrations(client, { ...options, migrations: [...migrations, probe, failure] }), /does not exist/);
    assert.equal(await ledgerCount(client, options), 5);
    await client.query("BEGIN");
    assert.ok(!(await readCatalog(client, options.schema))["column:tasks.migration_probe"]);
    await client.query("ROLLBACK");
    assert.deepEqual((await runMigrations(client, { ...options, migrations: [...migrations, probe] })).applied, [probe.tag]);
    assert.deepEqual((await runMigrations(client, { ...options, migrations: [...migrations, probe] })).applied, []);
    await client.query(`UPDATE ${q(options.journalSchema)}.__drizzle_migrations SET hash='altered' WHERE created_at=$1`, [probe.when]);
    await assert.rejects(runMigrations(client, { ...options, migrations: [...migrations, probe] }), /exact contiguous prefix/);
    await client.query(`DELETE FROM ${q(options.journalSchema)}.__drizzle_migrations WHERE created_at=$1`, [migrations[0].when]);
    await assert.rejects(runMigrations(client, { ...options, mode: "baseline" }), /exact contiguous prefix/);
  });
});

test("concurrent baseline attempts serialize and do not duplicate history", async () => {
  await fixture(async (client, options) => {
    await seed(client, options);
    const other = await pool.connect();
    try {
      const results = await Promise.all([
        runMigrations(client, { ...options, mode: "baseline" }),
        runMigrations(other, { ...options, mode: "baseline" }),
      ]);
      assert.equal(results.reduce((sum, result) => sum + result.recorded.length, 0), 5);
      assert.equal(await ledgerCount(client, options), 5);
    } finally {
      other.release();
    }
  });
});
