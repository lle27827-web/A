import assert from "node:assert/strict";
import test from "node:test";
import { canViewMemberManagement, resolvePermissions, verifiedAccountEmails } from "./permissions";

test("signed-in accounts can read member management; guests cannot", () => {
  assert.equal(canViewMemberManagement(true), true);
  assert.equal(canViewMemberManagement(false), false);
});

test("only verified owner owns administration; delegated manager only edits data", () => {
  const owner = "owner@example.com";
  const delegate = "manager@example.com";
  assert.deepEqual(resolvePermissions(owner, [owner], []), { ownerConfigured: true, isOwner: true, canManage: true });
  assert.deepEqual(resolvePermissions(owner, [delegate], [delegate]), { ownerConfigured: true, isOwner: false, canManage: true });
  assert.equal(resolvePermissions(owner, [delegate], []).canManage, false, "revoked grant must immediately deny data writes");
  assert.equal(resolvePermissions(owner, ["viewer@example.com"], [delegate]).canManage, false);
  assert.equal(resolvePermissions(undefined, [delegate], [delegate]).canManage, false, "configuration absent fails closed");
  assert.equal(resolvePermissions("  OWNER@example.com ", [" Owner@Example.com "], []).isOwner, true);
  assert.equal(resolvePermissions(owner, [" Manager@Example.com "], ["MANAGER@example.com"]).canManage, true);
  assert.equal(resolvePermissions(owner, [], [delegate]).canManage, false);
});

test("unverified owner or manager email cannot grant access", () => {
  const emails = verifiedAccountEmails([
    { emailAddress: "owner@example.com", verification: { status: "unverified" } },
    { emailAddress: "manager@example.com", verification: null },
    { emailAddress: "viewer@example.com", verification: { status: "verified" } },
  ]);
  assert.deepEqual(emails, ["viewer@example.com"]);
  assert.equal(resolvePermissions("owner@example.com", emails, ["manager@example.com"]).canManage, false);
});
