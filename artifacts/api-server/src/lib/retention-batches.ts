import { createHash } from "node:crypto";
import type { MutationDraft } from "@workspace/db";
import { commitPartitionedMutations, operationIdFromRequest } from "./partitioned-mutations";

export const RETENTION_MUTATION_BATCH_SIZE = 500;

export function chunkRetentionMutations<T>(items: readonly T[], size = RETENTION_MUTATION_BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > RETENTION_MUTATION_BATCH_SIZE) {
    throw new Error(`Retention batches must contain between 1 and ${RETENTION_MUTATION_BATCH_SIZE} items.`);
  }
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

export function retentionBatchOperationId(input: {
  action: string;
  rangeKey: string;
  batchIndex: number;
  requestId?: string;
  mutations: readonly Pick<MutationDraft, "entityType" | "entityKey" | "action">[];
}): string {
  const requestId = input.requestId
    ? operationIdFromRequest(input.requestId, "xóa lịch sử")
    : "";
  const hash = createHash("sha256")
    .update(JSON.stringify({
      action: input.action,
      rangeKey: input.rangeKey,
      batchIndex: input.batchIndex,
      requestId,
      rows: input.mutations.map(({ entityType, entityKey, action }) => [entityType, entityKey, action]),
    }))
    .digest("hex")
    .slice(0, 32)
    .split("");
  hash[12] = "5";
  hash[16] = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = hash.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function commitRetentionMutationBatches(
  mutations: readonly MutationDraft[],
  input: { action: string; rangeKey: string; requestId?: string },
): Promise<void> {
  const batches = chunkRetentionMutations(mutations);
  for (const [batchIndex, batch] of batches.entries()) {
    const operationId = retentionBatchOperationId({
      ...input,
      batchIndex,
      mutations: batch,
    });
    await commitPartitionedMutations({
      operationId,
      lockName: "retention",
      action: input.action,
      request: {
        rangeKey: input.rangeKey,
        batchIndex,
        entities: batch.map(({ entityType, entityKey, action }) => [entityType, entityKey, action]),
      },
      expectedEventCount: batch.length,
      build: () => batch,
    });
  }
}
