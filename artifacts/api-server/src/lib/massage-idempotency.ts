import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiWriteOperationsTable, db, hashPartitionRequest } from "@workspace/db";
import { operationIdFromRequest } from "./partitioned-mutations";
import { MassageError, type Tx } from "./massage-common";

export async function idempotentTransaction<T>(
  operationId: string | undefined,
  label: string,
  action: string,
  request: unknown,
  callback: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!operationId) return db.transaction(callback);
  const operationKey = operationIdFromRequest(operationId, label);
  const scoped = request && typeof request === "object" && !Array.isArray(request)
    ? request as Record<string, unknown>
    : {};
  const businessId = typeof scoped.businessId === "string" ? scoped.businessId : "";
  const userId = typeof scoped.userId === "string" ? scoped.userId : null;
  if (!businessId) throw new MassageError(400, "Thiếu mã cơ sở cho thao tác ghi.");
  const keyDigest = createHash("sha256")
    .update(`so-cong:idempotency:v2\0${businessId}\0${userId ?? ""}\0${operationKey}`, "utf8")
    .digest("hex").slice(0, 32).split("");
  keyDigest[12] = "5";
  keyDigest[16] = ((Number.parseInt(keyDigest[16]!, 16) & 0x3) | 0x8).toString(16);
  const key = `${keyDigest.slice(0, 8).join("")}-${keyDigest.slice(8, 12).join("")}-${keyDigest.slice(12, 16).join("")}-${keyDigest.slice(16, 20).join("")}-${keyDigest.slice(20).join("")}`;
  const requestHash = hashPartitionRequest({ action, businessId, userId, request });
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(apiWriteOperationsTable).values({
      operationId: key,
      businessId,
      userId: userId ?? "legacy",
      requestHash,
      result: { value: null },
    }).onConflictDoNothing().returning({ operationId: apiWriteOperationsTable.operationId });
    const [record] = await tx.select().from(apiWriteOperationsTable)
      .where(eq(apiWriteOperationsTable.operationId, key)).for("update");
    if (!record) throw new MassageError(503, "Không lưu được trạng thái chống ghi trùng.");
    if (record.requestHash !== requestHash) {
      throw new MassageError(409, "Mã yêu cầu đã được dùng cho nội dung khác. Hãy tải lại và thử lại.");
    }
    if (!inserted) return record.result.value as T;

    const result = await callback(tx);
    await tx.update(apiWriteOperationsTable).set({
      result: { value: result === undefined ? null : result },
    }).where(eq(apiWriteOperationsTable.operationId, key));
    return result;
  });
}
