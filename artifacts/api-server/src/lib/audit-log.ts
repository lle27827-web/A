import { createHash, randomUUID } from "node:crypto";

export type AuditLogRecord = {
  id: string;
  businessId: string;
  actorEmail: string | null;
  action: string;
  entity: string;
  entityId: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  createdAt: Date;
};

export function auditLogIdForOperation(operationId: string, businessId: string, action: string): string {
  const bytes = createHash("sha256")
    .update(`so-cong:audit:${businessId}:${action}:${operationId}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createAuditLogRecord(
  input: Omit<AuditLogRecord, "id" | "createdAt"> & { id?: string },
): AuditLogRecord {
  return {
    ...input,
    actorEmail: input.actorEmail?.trim().toLowerCase() || null,
    id: input.id ?? randomUUID(),
    createdAt: new Date(),
  };
}
