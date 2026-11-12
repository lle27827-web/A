import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertThreeDistinctStores,
  resolveConfiguredStores,
  resolveDirectConfiguredStores,
  resolveFailoverCoordinatorUrl,
  resolveMigrationTargetUrl,
} from "./vercel-stores.mjs";

const urls = {
  DATABASE_URL_1: "postgres://user:pass@ep-db1.us-east-2.aws.neon.tech/app",
  DATABASE_URL_2: "postgres://user:pass@ep-db2.us-east-2.aws.neon.tech/app",
  DATABASE_URL_3: "postgres://user:pass@ep-db3.us-east-2.aws.neon.tech/app",
};

test("runtime config resolves exactly DB1–DB3 and ignores legacy DB4", () => {
  const stores = resolveConfiguredStores({
    ...urls,
    DATABASE_URL_4: "postgres://user:pass@ep-db4.us-east-2.aws.neon.tech/app",
    DATABASE_URL_2: "postgres://user:pass@ep-db2-pooler.us-east-2.aws.neon.tech/app",
    NEON_DB2_DIRECT_URL: urls.DATABASE_URL_2,
  });
  assertThreeDistinctStores(stores);
  assert.deepEqual(stores.map(({ label }) => label), ["DB1", "DB2", "DB3"]);
  assert.deepEqual(stores.map(({ backend }) => backend), [
    "database_url_1",
    "database_url",
    "database_url_3",
  ]);
  assert.equal(stores[1].url, urls.DATABASE_URL_2);
});

test("direct URL aliases resolve to the same three runtime stores", () => {
  const env = {
    NEON_DB1_DIRECT_URL: urls.DATABASE_URL_1,
    DATABASE_URL_2_DIRECT: urls.DATABASE_URL_2,
    NEON_DB3_DIRECT_URL: urls.DATABASE_URL_3,
    DATABASE_URL_1: urls.DATABASE_URL_1,
    DATABASE_URL_2: urls.DATABASE_URL_2,
    DATABASE_URL_3: urls.DATABASE_URL_3,
  };
  assert.deepEqual(
    resolveDirectConfiguredStores(env).map(({ label }) => label),
    ["DB1", "DB2", "DB3"],
  );
  assertThreeDistinctStores(resolveConfiguredStores(env));
});

test("three-store validation reports missing and duplicate databases", () => {
  const duplicate = resolveConfiguredStores({
    ...urls,
    DATABASE_URL_3: "postgres://user:pass@ep-db2-pooler.us-east-2.aws.neon.tech/app",
  });
  assert.throws(
    () => assertThreeDistinctStores(duplicate),
    /resolved 2\/3\. Missing or duplicate store: DB3/,
  );
  assert.throws(
    () => assertThreeDistinctStores(resolveConfiguredStores({
      DATABASE_URL_1: urls.DATABASE_URL_1,
      DATABASE_URL_2: urls.DATABASE_URL_2,
    })),
    /resolved 2\/3\. Missing or duplicate store: DB3/,
  );
});

test("direct URL validation rejects poolers and mismatched numbered URLs", () => {
  assert.throws(
    () => resolveDirectConfiguredStores({
      NEON_DB1_DIRECT_URL: "postgres://user:secret@ep-db1-pooler.us-east-2.aws.neon.tech/app",
      DATABASE_URL_2: urls.DATABASE_URL_2,
      DATABASE_URL_3: urls.DATABASE_URL_3,
    }),
    (error) => {
      assert.match(error.message, /DB1 variable NEON_DB1_DIRECT_URL points to a pooler endpoint/);
      assert.doesNotMatch(error.message, /secret|ep-db1/);
      return true;
    },
  );
  assert.throws(
    () => resolveDirectConfiguredStores({
      NEON_DB1_DIRECT_URL: "postgres://user:pass@ep-other.us-east-2.aws.neon.tech/app",
      DATABASE_URL_1: urls.DATABASE_URL_1,
      DATABASE_URL_2: urls.DATABASE_URL_2,
      DATABASE_URL_3: urls.DATABASE_URL_3,
    }),
    /DB1 direct and runtime URLs must point to the same database/,
  );
});

test("coordinator defaults to DB3 and rejects non-configured backends", () => {
  const stores = resolveConfiguredStores(urls);
  assert.equal(resolveFailoverCoordinatorUrl({}, stores), urls.DATABASE_URL_3);
  assert.equal(
    resolveFailoverCoordinatorUrl(
      { DATABASE_FAILOVER_COORDINATOR_BACKEND: "database_url_3" },
      stores,
    ),
    urls.DATABASE_URL_3,
  );
  assert.throws(
    () => resolveFailoverCoordinatorUrl(
      { DATABASE_FAILOVER_COORDINATOR_BACKEND: "database_url_4" },
      stores,
    ),
    /valid failover coordinator URL or configured backend/,
  );
});

test("migration target and Vercel DB2 requirements remain explicit", () => {
  assert.equal(resolveMigrationTargetUrl({ DATABASE_URL: urls.DATABASE_URL_2 }), urls.DATABASE_URL_2);
  assert.throws(() => resolveMigrationTargetUrl({}), /DATABASE_URL must be configured/);
  assert.throws(
    () => resolveConfiguredStores({
      DATABASE_URL: urls.DATABASE_URL_2,
      DATABASE_URL_1: urls.DATABASE_URL_1,
      DATABASE_URL_3: urls.DATABASE_URL_3,
    }),
    /DB2 connection URL is required/,
  );
});

test("runtime DB2 accepts the configured direct source alias", () => {
  const stores = resolveConfiguredStores({
    DATABASE_URL_1: urls.DATABASE_URL_1,
    NEON_SOURCE_DIRECT_URL: urls.DATABASE_URL_2,
    DATABASE_URL_3: urls.DATABASE_URL_3,
  });
  assertThreeDistinctStores(stores);
  assert.equal(stores[1].url, urls.DATABASE_URL_2);
});

test("Vercel build keeps migration, verification, then API build", () => {
  const vercelConfig = JSON.parse(
    readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"),
  );
  const dbPackage = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const apiBuild = vercelConfig.services["api-server"].buildCommand;
  const migrateIndex = apiBuild.indexOf("pnpm --filter @workspace/db run migrate:all-vercel-stores");
  const verifyIndex = apiBuild.indexOf("pnpm --filter @workspace/db run migrate:verify-stores");
  const buildIndex = apiBuild.indexOf("pnpm -r --filter @workspace/api-server... --if-present run build");

  assert.ok(migrateIndex >= 0);
  assert.ok(verifyIndex > migrateIndex);
  assert.ok(buildIndex > verifyIndex);
  assert.equal(dbPackage.scripts["migrate:all-vercel-stores"], "node ./scripts/apply-vercel-stores.mjs");
  assert.equal(dbPackage.scripts["migrate:verify-stores"], "node ./scripts/verify-vercel-stores.mjs");
});
