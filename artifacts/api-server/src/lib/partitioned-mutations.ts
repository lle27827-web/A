import {
  appendReservedPartitionOperation,
  getReservedPartitionOperation,
  hashPartitionRequest,
  partitionEntityKey,
  reconcilePartitionOperation,
  reservePartitionOperation,
  withPartitionWriteMutex,
  type MutationDraft,
  type ReservedOperation,
} from "@workspace/db";
import { MassageError } from "./massage";

export async function reconcileAndReload<T>(
  operation: ReservedOperation,
  reconcile: (operation: ReservedOperation) => Promise<ReservedOperation>,
  reload: () => Promise<T>,
): Promise<{ operation: ReservedOperation; rows: T | null }> {
  const reconciled = await reconcile(operation);
  return {
    operation: reconciled,
    rows: reconciled.state === "committed" ? await reload() : null,
  };
}

export function operationIdFromRequest(value: unknown, label = "thao tác"): string {
  if (typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new MassageError(400, `Thiếu mã chống ghi trùng cho ${label}. Hãy tải lại trang và thử lại.`);
  }
  return value;
}

export async function commitPartitionedMutations(input: {
  operationId: string;
  lockName: string;
  action: string;
  request: unknown;
  expectedEventCount: number;
  idAllocations?: Readonly<Record<string, number>>;
  alreadyLocked?: boolean;
  build: (operation: ReservedOperation) => readonly MutationDraft[];
}): Promise<ReservedOperation> {
  const commit = async (): Promise<ReservedOperation> => {
    const requestHash = hashPartitionRequest({
      action: input.action,
      request: input.request,
    });
    const existing = await getReservedPartitionOperation(input.operationId, requestHash);
    let operation = existing ?? await reservePartitionOperation({
      operationId: input.operationId,
      requestHash,
      expectedEventCount: input.expectedEventCount,
      idAllocations: input.idAllocations ?? {},
    });
    operation = await reconcilePartitionOperation(operation);
    if (operation.state === "committed") return operation;
    if (operation.expectedEventCount !== input.expectedEventCount) {
      throw new MassageError(409, "Thao tác đã được gửi với cấu trúc khác. Hãy tải lại dữ liệu trước khi thử lại.");
    }
    const mutations = input.build(operation);
    await appendReservedPartitionOperation(operation, mutations);
    return { ...operation, state: "committed" as const };
  };
  return input.alreadyLocked ? commit() : withPartitionWriteMutex(input.lockName, commit);
}

export function upsertMutation(
  entityType: string,
  id: string | number,
  payload: Record<string, unknown>,
): MutationDraft {
  return {
    entityType,
    entityKey: partitionEntityKey(entityType, id),
    action: "upsert",
    payload,
  };
}

export function deleteMutation(entityType: string, id: string | number): MutationDraft {
  return {
    entityType,
    entityKey: partitionEntityKey(entityType, id),
    action: "delete",
    payload: null,
  };
}
