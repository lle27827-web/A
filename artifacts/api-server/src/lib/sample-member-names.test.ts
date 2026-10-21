import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSampleMemberNames,
  sampleMemberBatchConfirmation,
  sampleMemberBatchSize,
} from "./sample-member-names";

test("sample member batch contains the requested 1,000 sequential names", () => {
  const names = buildSampleMemberNames();
  assert.equal(names.length, sampleMemberBatchSize);
  assert.equal(names[0], "Nhân viên 1");
  assert.equal(names.at(-1), "Nhân viên 1000");
  assert.equal(new Set(names).size, 1000);
});

test("sample member confirmation is a fixed, non-secret phrase", () => {
  assert.equal(sampleMemberBatchConfirmation, "TAO_1000_NHAN_VIEN_MAU");
});
