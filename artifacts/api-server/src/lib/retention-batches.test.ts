import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkRetentionMutations,
  retentionBatchOperationId,
  RETENTION_MUTATION_BATCH_SIZE,
} from "./retention-batches";

test("retention mutation batching caps batches at 500 and covers each row once", () => {
  const items = Array.from({ length: 1_201 }, (_, index) => index);
  const batches = chunkRetentionMutations(items);
  assert.deepEqual(batches.map((batch) => batch.length), [500, 500, 201]);
  assert.deepEqual(batches.flat(), items);
  assert.equal(RETENTION_MUTATION_BATCH_SIZE, 500);
});

test("retention batch operation IDs are deterministic, valid UUIDs, and change per batch", () => {
  const base = {
    action: "retention.delete-range",
    rangeKey: "2026-01-01:2026-01-31",
    requestId: "c3a5a0d2-c3fd-4adb-9b5e-3a6c293d9c24",
    mutations: [{ entityType: "attendance", entityKey: "attendance:1", action: "delete" as const }],
  };
  const first = retentionBatchOperationId({ ...base, batchIndex: 0 });
  assert.equal(first, retentionBatchOperationId({ ...base, batchIndex: 0 }));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, retentionBatchOperationId({ ...base, batchIndex: 1 }));
  assert.notEqual(first, retentionBatchOperationId({ ...base, rangeKey: "2026-02-01:2026-02-28", batchIndex: 0 }));
});
