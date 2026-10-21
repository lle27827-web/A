import type { DatabaseBackend, DatabaseNodeConfig } from "./failover-topology";

export type PartitionMutationAction = "upsert" | "delete";

export type PartitionMutation = {
  eventId: string;
  operationId: string;
  revision: string;
  entityType: string;
  entityKey: string;
  action: PartitionMutationAction;
  payload: Record<string, unknown> | null;
};

export type PartitionCapacityState =
  | "available"
  | "full"
  | "unavailable"
  | "unknown";

export class PartitionRoutingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "coordinator_unavailable"
      | "capacity_unknown"
      | "no_writable_store"
      | "invalid_cursor",
  ) {
    super(message);
    this.name = "PartitionRoutingError";
  }
}

export function makePartitionEntityKey(
  sourceBackend: DatabaseBackend,
  localId: string | number,
): string {
  const normalizedId = String(localId);
  if (!/^[1-9]\d*$/.test(normalizedId)) {
    throw new Error("Partitioned entity IDs must be positive integers.");
  }
  return `${sourceBackend}:${normalizedId}`;
}

export function comparePartitionRevisions(left: string, right: string): number {
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) {
    throw new Error("Partition revisions must be non-negative integers.");
  }
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rebuild the current view from the canonical pre-partition snapshot and
 * append-only mutations. Duplicate event IDs are ignored for idempotent reads.
 */
export function applyPartitionMutations<T extends Record<string, unknown>>(
  baseRows: ReadonlyMap<string, T>,
  mutations: readonly PartitionMutation[],
): Map<string, T> {
  const current = new Map(baseRows);
  const seenEventIds = new Set<string>();
  const ordered = [...mutations].sort((left, right) => {
    const revisionOrder = comparePartitionRevisions(left.revision, right.revision);
    return revisionOrder || left.eventId.localeCompare(right.eventId);
  });

  for (const mutation of ordered) {
    if (seenEventIds.has(mutation.eventId)) continue;
    seenEventIds.add(mutation.eventId);

    if (!mutation.entityType.trim() || !mutation.entityKey.trim()) {
      throw new Error("Partition mutations require an entity type and key.");
    }
    if (mutation.action === "delete") {
      if (mutation.payload !== null) {
        throw new Error("Delete mutations cannot include a replacement payload.");
      }
      current.delete(mutation.entityKey);
      continue;
    }
    if (mutation.action !== "upsert" || mutation.payload === null) {
      throw new Error("Upsert mutations require a replacement payload.");
    }
    current.set(mutation.entityKey, mutation.payload as T);
  }

  return current;
}

export function nextPartitionWriteBackend(
  current: DatabaseBackend,
  nodes: readonly Pick<DatabaseNodeConfig, "backend">[],
): DatabaseBackend | undefined {
  const currentIndex = nodes.findIndex((node) => node.backend === current);
  return currentIndex >= 0 ? nodes[currentIndex + 1]?.backend : undefined;
}

/**
 * Pick the first verified writable shard at or after the persisted cursor.
 * Partition routing only moves forward: a full/unavailable shard is never
 * revisited, and unknown capacity blocks routing rather than risking a write
 * into an unverified store.
 */
export function resolvePartitionWriteBackend(
  current: DatabaseBackend,
  orderedBackends: readonly DatabaseBackend[],
  capacity: ReadonlyMap<DatabaseBackend, PartitionCapacityState>,
): DatabaseBackend {
  const currentIndex = orderedBackends.indexOf(current);
  if (currentIndex < 0) {
    throw new PartitionRoutingError(
      "The persisted partition cursor is not part of the configured store order.",
      "invalid_cursor",
    );
  }
  for (let index = currentIndex; index < orderedBackends.length; index += 1) {
    const backend = orderedBackends[index]!;
    const state = capacity.get(backend) ?? "unknown";
    if (state === "available") return backend;
    if (state === "unknown") {
      throw new PartitionRoutingError(
        `Capacity for ${backend} could not be verified; writes are blocked.`,
        "capacity_unknown",
      );
    }
  }
  throw new PartitionRoutingError(
    "No writable database remains after the current partition cursor.",
    "no_writable_store",
  );
}
