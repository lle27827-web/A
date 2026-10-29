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

export type PartitionReplicaPair = {
  primary: DatabaseBackend;
  replica: DatabaseBackend;
};

export function buildPartitionEventInsertBatch(events: readonly PartitionMutation[]) {
  return {
    eventIds: events.map((event) => event.eventId),
    operationIds: events.map((event) => event.operationId),
    revisions: events.map((event) => event.revision),
    entityTypes: events.map((event) => event.entityType),
    entityKeys: events.map((event) => event.entityKey),
    actions: events.map((event) => event.action),
    payloads: events.map((event) => event.payload === null ? null : JSON.stringify(event.payload)),
  };
}

export type PartitionComputeSnapshot = { seconds: number; checkedAt: number };

export function resolvePartitionComputeState(input: {
  now: number;
  freshSeconds?: number;
  cached?: PartitionComputeSnapshot;
  requireCheck: boolean;
  limitSeconds: number;
  maxCacheAgeMs?: number;
}): PartitionCapacityState {
  if (input.freshSeconds !== undefined) {
    return input.freshSeconds >= input.limitSeconds ? "unavailable" : "available";
  }
  const age = input.cached ? input.now - input.cached.checkedAt : Number.POSITIVE_INFINITY;
  if (input.cached && age >= 0 && age <= (input.maxCacheAgeMs ?? 6 * 60 * 60_000)) {
    return input.cached.seconds >= input.limitSeconds ? "unavailable" : "available";
  }
  return input.requireCheck ? "unknown" : "available";
}

export function shouldAdvancePartitionCursor(
  failure: "full" | "unavailable",
  current: DatabaseBackend,
  next: DatabaseBackend,
  orderedBackends: readonly DatabaseBackend[],
): boolean {
  return failure === "full" &&
    orderedBackends.indexOf(next) > orderedBackends.indexOf(current);
}

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
 * Only a persistently full shard is skipped by the caller's stored cursor;
 * unavailable shards are skipped for this operation, and unknown capacity
 * blocks routing rather than risking an unverified write.
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

/**
 * Choose two verified writable stores. The primary moves forward from the
 * persisted cursor; the second copy may wrap around the ring so DB4 can also
 * receive a replica without moving the primary cursor backwards.
 */
export function resolvePartitionWritePair(
  current: DatabaseBackend,
  orderedBackends: readonly DatabaseBackend[],
  capacity: ReadonlyMap<DatabaseBackend, PartitionCapacityState>,
): PartitionReplicaPair {
  const currentIndex = orderedBackends.indexOf(current);
  if (currentIndex < 0) {
    throw new PartitionRoutingError(
      "The persisted partition cursor is not part of the configured store order.",
      "invalid_cursor",
    );
  }

  let primaryIndex = -1;
  for (let index = currentIndex; index < orderedBackends.length; index += 1) {
    const state = capacity.get(orderedBackends[index]!) ?? "unknown";
    if (state === "unknown") {
      throw new PartitionRoutingError(
        `Capacity for ${orderedBackends[index]} could not be verified; writes are blocked.`,
        "capacity_unknown",
      );
    }
    if (state === "available") {
      primaryIndex = index;
      break;
    }
  }
  if (primaryIndex < 0) {
    throw new PartitionRoutingError(
      "No writable primary remains after the current partition cursor.",
      "no_writable_store",
    );
  }

  for (let offset = 1; offset < orderedBackends.length; offset += 1) {
    const replicaIndex = (primaryIndex + offset) % orderedBackends.length;
    const replica = orderedBackends[replicaIndex]!;
    const state = capacity.get(replica) ?? "unknown";
    if (state === "unknown") {
      throw new PartitionRoutingError(
        `Capacity for ${replica} could not be verified; writes are blocked.`,
        "capacity_unknown",
      );
    }
    if (replica !== orderedBackends[primaryIndex] && state === "available") {
      return {
        primary: orderedBackends[primaryIndex]!,
        replica,
      };
    }
  }

  throw new PartitionRoutingError(
    "Two verified writable stores are required before a partition write can be acknowledged.",
    "no_writable_store",
  );
}
