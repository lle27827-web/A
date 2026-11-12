import assert from "node:assert/strict";
import test from "node:test";
import { mapBackendValues, rowsEquivalent, transformRow } from "./db4-to-db3-data.mjs";

test("maps nested DB4 references to DB3 while keeping replica backends distinct", () => {
  assert.deepEqual(
    mapBackendValues({
      sourceBackend: "database_url_4",
      nested: [{ targetBackend: "database_url_4", replicaBackend: "database_url_4" }],
    }),
    {
      sourceBackend: "database_url_3",
      nested: [{ targetBackend: "database_url_3", replicaBackend: "database_url_1" }],
    },
  );
});

test("rewrites DB4 coordinator and failover references", () => {
  assert.deepEqual(
    transformRow("storage_partition_state", {
      id: 1,
      write_backend: "database_url_4",
    }),
    { id: 1, write_backend: "database_url_3" },
  );
  assert.deepEqual(
    transformRow("db_failover_state", {
      id: 1,
      active_backend: "database_url_4",
      switch_source_backend: "database_url_4",
      switch_target_backend: "database_url_4",
    }),
    {
      id: 1,
      active_backend: "database_url_3",
      switch_source_backend: "database_url_3",
      switch_target_backend: "database_url_3",
    },
  );
});

test("refuses to migrate a failover that is actively switching", () => {
  assert.throws(
    () => transformRow("db_failover_state", { active_backend: "switching" }),
    /resolve it before migration/,
  );
});

test("ignores only the metadata timestamp when matching night-pricing settings", () => {
  const source = { id: 1, enabled: true, start_time: "22:00", updated_at: new Date("2026-01-01") };
  const target = { id: 1, enabled: true, start_time: "22:00", updated_at: new Date("2026-02-01") };
  assert.equal(rowsEquivalent("facility_night_settings", source, target), true);
  assert.equal(rowsEquivalent("personal_settings", source, target), false);
  assert.equal(
    rowsEquivalent("facility_night_settings", source, { ...target, enabled: false }),
    false,
  );
});
