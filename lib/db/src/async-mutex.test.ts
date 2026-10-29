import assert from "node:assert/strict";
import test from "node:test";
import { createAsyncMutex } from "./async-mutex";

test("a local async mutex serializes partition writes without dropping either request", async () => {
  const runExclusive = createAsyncMutex();
  let active = 0;
  let maximum = 0;
  const run = async (value: string) => runExclusive(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value;
  });

  assert.deepEqual(await Promise.all([run("one"), run("two")]), ["one", "two"]);
  assert.equal(maximum, 1);
});
