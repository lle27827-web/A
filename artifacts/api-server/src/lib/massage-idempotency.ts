import { and, eq } from "drizzle-orm";
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
  const key = operationIdFromRequest(operationId, label);
  const requestHash = hashPartitionRequest({ action, request });
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(apiWriteOperationsTable).values({
      operationId: key,
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
