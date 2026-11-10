import assert from "node:assert/strict";
import test from "node:test";
import { isMalformedJsonBodyError } from "./request-validation";

test("malformed Express JSON parser errors are recognized for a 400 response", () => {
  assert.equal(isMalformedJsonBodyError({ type: "entity.parse.failed", status: 400 }), true);
  assert.equal(isMalformedJsonBodyError(new SyntaxError("bad json")), false);
  assert.equal(isMalformedJsonBodyError({ type: "entity.too.large", status: 413 }), false);
  assert.equal(isMalformedJsonBodyError(null), false);
});
