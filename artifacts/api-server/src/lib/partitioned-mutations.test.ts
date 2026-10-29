import assert from "node:assert/strict";
import test from "node:test";
import type { ReservedOperation } from "@workspace/db";
import { reconcileAndReload } from "./partitioned-mutations";

test("a committed retry reloads the post-commit table snapshot", async () => {
  let stored = "before";
  const operation = { state: "reserved" } as unknown as ReservedOperation;
  const result = await reconcileAndReload(
    operation,
    async () => {
      stored = "after";
      return { state: "committed" } as unknown as ReservedOperation;
    },
    async () => stored,
  );
  assert.equal(result.operation.state, "committed");
  assert.equal(result.rows, "after");
});
