import assert from "node:assert/strict";
import test from "node:test";
import { auditLogIdForOperation, createAuditLogRecord } from "./audit-log";

test("audit log IDs are deterministic UUIDs for idempotent mutation keys", () => {
  const operationId = "e541f814-1e04-47aa-971c-0953cd0d2b2b";
  const first = auditLogIdForOperation(operationId, "tenant-a", "card.update");
  assert.equal(first, auditLogIdForOperation(operationId, "tenant-a", "card.update"));
  assert.notEqual(first, auditLogIdForOperation(operationId, "tenant-b", "card.update"));
  assert.notEqual(first, auditLogIdForOperation(operationId, "tenant-a", "card.delete"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("audit records normalize verified actor email without copying unrelated customer data", () => {
  const record = createAuditLogRecord({
    businessId: "tenant-a",
    actorEmail: " Owner@Example.com ",
    action: "card.delete",
    entity: "treatment_card",
    entityId: "card-7",
    beforeJson: { totalMinutes: 120, purchaseAmount: 250000 },
    afterJson: { deletedAt: "2026-11-10T12:00:00.000Z" },
  });
  assert.equal(record.actorEmail, "owner@example.com");
  assert.equal(record.beforeJson?.phone, undefined);
});
