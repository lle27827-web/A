import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const REVIEWED = JSON.parse(await readFile(new URL("./baseline-reviewed.json", import.meta.url), "utf8"));
export const REVIEWED_MIGRATION_COUNT = Object.keys(REVIEWED).length;
export const APPLICATION_TABLES = [
  "attendance", "card_top_ups", "manager_grants", "member_versions", "members",
  "service_sessions", "service_types", "tasks", "treatment_cards", "card_usage_history",
];
export const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

// For isolated test/reference schemas only. Reviewed SQL has only these two forms
// of explicit public references. Real migrations execute the original SQL.
export function inSchema(sql, schema) {
  return sql.replaceAll('"public".', `${quoteIdentifier(schema)}.`)
    .replaceAll("'public.", `'${schema}.`);
}

export async function applySql(client, sql, schema) {
  await client.query("SELECT set_config('search_path', $1, true)", [`${quoteIdentifier(schema)}, pg_catalog`]);
  for (const statement of inSchema(sql, schema).split("--> statement-breakpoint").filter((part) => part.trim())) {
    await client.query(statement);
  }
}

export async function readCatalog(client, schema) {
  // Force qualified regclass/constraint/index expressions on both sides.
  await client.query("SET LOCAL search_path = pg_catalog");
  const queries = {
    table: `SELECT c.relname AS name, c.relkind AS kind, c.relpersistence AS persistence,
      c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname=ANY($2::text[])`,
    column: `SELECT c.relname||'.'||a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_expression,
      a.attidentity AS identity, a.attgenerated AS generated,
      cn.nspname||'.'||co.collname AS collation
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      LEFT JOIN pg_collation co ON co.oid=a.attcollation
      LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
      WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND a.attnum>0 AND NOT a.attisdropped`,
    constraint: `SELECT c.relname||'.'||con.conname AS name, con.contype AS type,
      pg_get_constraintdef(con.oid,false) AS definition, con.convalidated AS validated,
      con.condeferrable AS deferrable, con.condeferred AS initially_deferred
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname=ANY($2::text[])`,
    index: `SELECT c.relname||'.'||ic.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
      i.indisvalid AS valid, i.indisready AS ready
      FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
      JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname=ANY($2::text[])`,
    sequence: `SELECT sc.relname AS name, format_type(s.seqtypid,NULL) AS type,
      s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle,
      tn.nspname AS owner_schema, tc.relname AS owner_table, a.attname AS owner_column
      FROM pg_sequence s JOIN pg_class sc ON sc.oid=s.seqrelid
      JOIN pg_depend d ON d.objid=sc.oid AND d.classid='pg_class'::regclass
        AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')
      JOIN pg_class tc ON tc.oid=d.refobjid JOIN pg_namespace tn ON tn.oid=tc.relnamespace
      JOIN pg_attribute a ON a.attrelid=tc.oid AND a.attnum=d.refobjsubid
      WHERE tn.nspname=$1 AND tc.relname=ANY($2::text[])`,
    trigger: `SELECT c.relname||'.'||t.tgname AS name, pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND NOT t.tgisinternal`,
  };
  const catalog = {};
  for (const [kind, sql] of Object.entries(queries)) {
    const { rows } = await client.query(sql, [schema, APPLICATION_TABLES]);
    for (const row of rows) {
      const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
        typeof value !== "string" ? value : value === schema ? "__schema__"
          : value.replaceAll(`${quoteIdentifier(schema)}.`, "__schema__.").replaceAll(`${schema}.`, "__schema__."),
      ]));
      catalog[`${kind}:${row.name}`] = normalized;
    }
  }
  return catalog;
}

export function catalogDifferences(expected, actual) {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
    .filter((key) => JSON.stringify(expected[key]) !== JSON.stringify(actual[key]))
    .map((key) => `${key}: ${!actual[key] ? "missing" : !expected[key] ? "unexpected" : "definition differs"}`);
}

export async function referenceProfiles(client, migrations) {
  const entries = Object.entries(REVIEWED);
  // Never execute unreviewed future migration SQL in an audit shadow schema.
  // Pin the reviewed files, including their DML and explicit schema references.
  for (const [index, [tag, hash]] of entries.entries()) {
    if (migrations[index]?.tag !== tag || migrations[index]?.hash !== hash) {
      throw new Error(`Reviewed migration changed or missing: ${tag}. Restore it; append a new migration instead.`);
    }
  }
  const schema = `migration_reference_${randomUUID().replaceAll("-", "")}`;
  const profiles = [];
  await client.query("SAVEPOINT reference_schema");
  try {
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    for (const migration of migrations.slice(0, entries.length)) {
      await applySql(client, migration.sql, schema);
      profiles.push({ migration, catalog: await readCatalog(client, schema) });
    }
  } finally {
    // All reference DDL/data is rolled back; never drop a pre-existing schema.
    await client.query("ROLLBACK TO SAVEPOINT reference_schema");
    await client.query("RELEASE SAVEPOINT reference_schema");
  }
  return profiles;
}

export async function verifyBackfills(client, schema, index) {
  const qualified = (table) => `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  if (index >= 3) {
    const { rows } = await client.query(`SELECT EXISTS (
      SELECT 1 FROM ${qualified("members")} m WHERE NOT EXISTS (
        SELECT 1 FROM ${qualified("member_versions")} v WHERE v.member_id=m.id
      )) AS missing`);
    if (rows[0].missing) throw new Error("Employee history backfill is incomplete; run migrate:employee-history before baselining.");
  }
  if (index >= 4) {
    const { rows } = await client.query(`SELECT EXISTS (
      SELECT 1 FROM ${qualified("treatment_cards")} c
      WHERE c.first_used_at IS NULL AND EXISTS (
        SELECT 1 FROM ${qualified("service_sessions")} s WHERE s.card_id=c.id
      )) AS missing`);
    if (rows[0].missing) throw new Error("Card usage backfill is incomplete; run migrate:card-usage-lock before baselining.");
  }
}
