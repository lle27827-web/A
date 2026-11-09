import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertFourDistinctStores,
  resolveConfiguredStores,
  resolveDirectConfiguredStores,
  resolveFailoverCoordinatorUrl,
  resolveMigrationTargetUrl,
} from "./vercel-stores.mjs";

test("configured stores prefer direct URLs and keep only unique databases", () => {
  const stores = resolveConfiguredStores({
    DATABASE_URL_1: "postgres://user:pass@ep-db1-pooler.us-east-2.aws.neon.tech/app",
    NEON_DB1_DIRECT_URL: "postgres://user:pass@ep-db1.us-east-2.aws.neon.tech/app",
    DATABASE_URL: "postgres://user:pass@ep-db2-pooler.us-east-2.aws.neon.tech/app",
    DATABASE_URL_DIRECT: "postgres://user:pass@ep-db2.us-east-2.aws.neon.tech/app",
    DATABASE_URL_3: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
    MIGRATE_DATABASE_URL_3_DIRECT: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
    DATABASE_URL_4: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
    MIGRATE_DATABASE_URL_4_DIRECT: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
  });
  assertFourDistinctStores(stores);
  assert.deepEqual(stores.map(({ label }) => label), ["DB1", "DB2", "DB3", "DB4"]);
  assert.ok(stores.every(({ url }) => !url.includes("-pooler")));
});

test("tenancy migration resolves each supported direct URL alias consistently", () => {
  const stores = resolveDirectConfiguredStores({
    DATABASE_URL_1_DIRECT: "postgres://user:pass@ep-db1.us-east-2.aws.neon.tech/app",
    DATABASE_URL_DIRECT: "postgres://user:pass@ep-db2.us-east-2.aws.neon.tech/app",
    DATABASE_URL_3_DIRECT: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
    DATABASE_URL_4_DIRECT: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
  });

  assert.deepEqual(stores.map(({ label }) => label), ["DB1", "DB2", "DB3", "DB4"]);
  assert.ok(stores.every(({ url }) => !url.includes("-pooler")));
});

test("all four NEON_DBn_DIRECT_URL aliases resolve consistently", () => {
  const env = {
    NEON_DB1_DIRECT_URL: "postgres://user:pass@ep-db1.us-east-2.aws.neon.tech/app",
    NEON_DB2_DIRECT_URL: "postgres://user:pass@ep-db2.us-east-2.aws.neon.tech/app",
    NEON_DB3_DIRECT_URL: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
    NEON_DB4_DIRECT_URL: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
    DATABASE_URL: "postgres://user:pass@ep-db2-pooler.us-east-2.aws.neon.tech/app",
  };

  const stores = resolveDirectConfiguredStores(env);
  assertFourDistinctStores(resolveConfiguredStores(env));
  assert.deepEqual(
    stores.map(({ label }) => label),
    ["DB1", "DB2", "DB3", "DB4"],
  );
  assert.ok(stores.every(({ url }) => !new URL(url).hostname.includes("-pooler")));
});

test("build migrations can use the four runtime URL variables when they are direct", () => {
  const env = {
    DATABASE_URL_1: "postgres://user:pass@ep-db1.us-east-2.aws.neon.tech/app",
    DATABASE_URL: "postgres://user:pass@ep-db2.us-east-2.aws.neon.tech/app",
    DATABASE_URL_3: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
    DATABASE_URL_4: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
  };

  const stores = resolveDirectConfiguredStores(env);
  assert.deepEqual(
    stores.map(({ backend, url }) => [backend, url]),
    [
      ["database_url_1", env.DATABASE_URL_1],
      ["database_url", env.DATABASE_URL],
      ["database_url_3", env.DATABASE_URL_3],
      ["database_url_4", env.DATABASE_URL_4],
    ],
  );
});

test("direct endpoint validation identifies missing and pooled URLs without exposing values", () => {
  assert.throws(
    () => resolveDirectConfiguredStores({
      NEON_DB1_DIRECT_URL: "postgres://user:pass@ep-db1.us-east-2.aws.neon.tech/app",
      DATABASE_URL_3_DIRECT: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
      DATABASE_URL_4_DIRECT: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
    }),
    (error) => {
      assert.match(error.message, /DB2 requires a direct Neon endpoint/);
      assert.match(error.message, /DATABASE_URL_DIRECT or NEON_SOURCE_DIRECT_URL/);
      return true;
    },
  );
  assert.throws(
    () => resolveDirectConfiguredStores({
      NEON_DB1_DIRECT_URL: "postgres://user:pass@ep-db1.us-east-2.aws.neon.tech/app",
      NEON_SOURCE_DIRECT_URL: "postgres://user:secret@ep-db2-pooler.us-east-2.aws.neon.tech/app",
      MIGRATE_DATABASE_URL_3_DIRECT: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
      MIGRATE_DATABASE_URL_4_DIRECT: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
    }),
    (error) => {
      assert.match(error.message, /DB2 variable NEON_SOURCE_DIRECT_URL points to a pooler endpoint/);
      assert.doesNotMatch(error.message, /secret|ep-db2/);
      return true;
    },
  );
  assert.throws(
    () => resolveDirectConfiguredStores({
      DATABASE_URL_1: "postgres://user:secret@ep-db1-pooler.us-east-2.aws.neon.tech/app",
      DATABASE_URL: "postgres://user:pass@ep-db2.us-east-2.aws.neon.tech/app",
      DATABASE_URL_3: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
      DATABASE_URL_4: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
    }),
    (error) => {
      assert.match(error.message, /DB1 variable DATABASE_URL_1 points to a pooler endpoint/);
      assert.doesNotMatch(error.message, /secret|ep-db1/);
      return true;
    },
  );
  assert.throws(
    () => resolveDirectConfiguredStores({
      NEON_DB1_DIRECT_URL: "postgres://user:pass@ep-db1-pooler.us-east-2.aws.neon.tech/app",
      DATABASE_URL_1: "postgres://user:pass@ep-db1.us-east-2.aws.neon.tech/app",
      NEON_DB2_DIRECT_URL: "postgres://user:pass@ep-db2.us-east-2.aws.neon.tech/app",
      NEON_DB3_DIRECT_URL: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
      NEON_DB4_DIRECT_URL: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
    }),
    /DB1 variable NEON_DB1_DIRECT_URL points to a pooler endpoint/,
  );
});

test("configured stores can fall back to pooled URLs for transaction-safe migrations", () => {
  const stores = resolveConfiguredStores({
    DATABASE_URL_1: "postgres://user:pass@ep-db1-pooler.us-east-2.aws.neon.tech/app",
    DATABASE_URL: "postgres://user:pass@ep-db2-pooler.us-east-2.aws.neon.tech/app",
    DATABASE_URL_3: "postgres://user:pass@ep-db3-pooler.us-east-2.aws.neon.tech/app",
    DATABASE_URL_4: "postgres://user:pass@ep-db4-pooler.us-east-2.aws.neon.tech/app",
  });

  assert.deepEqual(stores.map(({ label }) => label), ["DB1", "DB2", "DB3", "DB4"]);
  assert.ok(stores.every(({ url }) => new URL(url).hostname.includes("-pooler")));
});

test("four-store validation reports missing or duplicate stores before migrations", () => {
  const stores = resolveConfiguredStores({
    DATABASE_URL: "postgres://user:pass@ep-db2.us-east-2.aws.neon.tech/app",
    DATABASE_URL_1: "postgres://user:pass@ep-db1.us-east-2.aws.neon.tech/app",
    DATABASE_URL_3: "postgres://user:pass@ep-db2-pooler.us-east-2.aws.neon.tech/app",
    DATABASE_URL_4: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
  });
  assert.throws(
    () => assertFourDistinctStores(stores),
    /resolved 3\/4\. Missing or duplicate store: DB3/,
  );
});

test("per-store migrations use the overridden DATABASE_URL target only", () => {
  const targetUrl = "postgres://user:pass@ep-current-target.us-east-2.aws.neon.tech/app";
  assert.equal(
    resolveMigrationTargetUrl({
      DATABASE_URL: targetUrl,
      DATABASE_URL_DIRECT: "postgres://user:pass@ep-original-db2.us-east-2.aws.neon.tech/app",
      NEON_SOURCE_DIRECT_URL: "postgres://user:pass@ep-original-db2.us-east-2.aws.neon.tech/app",
      DATABASE_URL_1: "postgres://user:pass@ep-db1.us-east-2.aws.neon.tech/app",
      DATABASE_URL_3: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
      DATABASE_URL_4: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
    }),
    targetUrl,
  );
  assert.throws(
    () => resolveMigrationTargetUrl({}),
    /DATABASE_URL must be configured for the migration target/,
  );
});

test("coordinator resolves to the selected configured store or separate URL", () => {
  const stores = resolveConfiguredStores({
    DATABASE_URL: "postgres://user:pass@db2.example/app",
    DATABASE_URL_4: "postgres://user:pass@db4.example/app",
  });
  assert.equal(resolveFailoverCoordinatorUrl({}, stores), stores[1].url);
  assert.equal(
    resolveFailoverCoordinatorUrl(
      { DATABASE_FAILOVER_COORDINATOR_BACKEND: "database_url_4" },
      stores,
    ),
    stores[1].url,
  );
  assert.equal(
    resolveFailoverCoordinatorUrl(
      { DATABASE_FAILOVER_COORDINATOR_URL: "postgres://user:pass@coord.example/db" },
      stores,
    ),
    "postgres://user:pass@coord.example/db",
  );
});

test("coordinator checks are skipped without failover and reject missing configured coordinators", () => {
  const stores = resolveConfiguredStores({
    DATABASE_URL: "postgres://user:pass@db2.example/app",
  });
  assert.equal(resolveFailoverCoordinatorUrl({}, stores), null);
  assert.throws(
    () =>
      resolveFailoverCoordinatorUrl(
        { DATABASE_FAILOVER_COORDINATOR_BACKEND: "database_url_4" },
        stores,
      ),
    /configured failover coordinator database is missing/,
  );
});

test("missing DB2 and invalid database URLs fail without printing connection values", () => {
  assert.throws(() => resolveConfiguredStores({}), /DATABASE_URL must be configured/);
  assert.throws(
    () =>
      resolveConfiguredStores({
        DATABASE_URL: "postgres://user:pass@db2.example/app",
        DATABASE_URL_3: "not-a-database-url",
      }),
    /DB3 has an invalid database URL/,
  );
});

test("Vercel API build keeps automatic migrations, verification, then API build", () => {
  const vercelConfig = JSON.parse(
    readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"),
  );
  const dbPackage = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const apiBuild = vercelConfig.services["api-server"].buildCommand;
  const migrateIndex = apiBuild.indexOf(
    "pnpm --filter @workspace/db run migrate:all-vercel-stores",
  );
  const verifyIndex = apiBuild.indexOf(
    "pnpm --filter @workspace/db run migrate:verify-stores",
  );
  const buildIndex = apiBuild.indexOf(
    "pnpm -r --filter @workspace/api-server... --if-present run build",
  );

  assert.ok(migrateIndex >= 0);
  assert.ok(verifyIndex > migrateIndex);
  assert.ok(buildIndex > verifyIndex);
  assert.equal(
    dbPackage.scripts["migrate:all-vercel-stores"],
    "node ./scripts/apply-vercel-stores.mjs",
  );
  assert.equal(
    dbPackage.scripts["migrate:verify-stores"],
    "node ./scripts/verify-vercel-stores.mjs",
  );
  assert.ok(vercelConfig.services["mockup-sandbox"]);
  assert.ok(vercelConfig.services["task-manager"]);
});
