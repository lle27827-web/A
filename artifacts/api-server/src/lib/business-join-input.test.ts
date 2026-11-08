import assert from "node:assert/strict";
import test from "node:test";
import { JoinBusinessBody } from "@workspace/api-zod";

test("joining a business accepts its 10-digit code without a business name", () => {
  assert.deepEqual(JoinBusinessBody.parse({ code: "0123456789" }), { code: "0123456789" });
  assert.equal(JoinBusinessBody.safeParse({ code: "12345" }).success, false);
});
