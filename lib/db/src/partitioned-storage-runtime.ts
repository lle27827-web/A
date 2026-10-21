import { createHash } from "node:crypto";
import pg from "pg";
import {
  DATABASE_COMPUTE_LIMIT_SECONDS,
  DATABASE_STORAGE_LIMIT_BYTES,
  hasReachedComputeTimeLimit,
  hasReachedDatabaseCapacity,
  isDatabaseAvailabilityError,
  isDatabaseCapacityError,
  parseDatabaseCapacityLimit,
  parseNeonComputeTimeSeconds,
} from "./failover-utils";
import {
  resolvePartitionWritePair,
  type PartitionCapacityState,
  type PartitionMutation,
} from "./storage-partitioning";
import {
  resolveDatabaseNodes,
  type DatabaseBackend,
  type DatabaseNodeConfig,
} from "./failover-topology";

type RuntimeNode = Omit<DatabaseNodeConfig, "maxBytes"> & { pool: pg.Pool; maxBytes: bigint };
type IdAllocation = Record<string, number[]>;
export type ReservedOperation = {
  operationId: string;
  requestHash: string;
  targetBackend: DatabaseBackend;
  replicaBackend: DatabaseBackend;
  revision: string;
  expectedEventCount: number;
  allocatedIds: IdAllocation;
  state: "pending" | "committed" | "needs_reconciliation";
};
export type MutationDraft = Omit<PartitionMutation, "eventId" | "operationId" | "revision">;

const BACKEND_ORDER: readonly DatabaseBackend[] = [
  "database_url_1",
  "database_url",
  "database_url_3",
  "database_url_4",
];
const BASE_TABLES = new Set([
  "members",
  "member_versions",
  "attendance",
  "treatment_cards",
  "card_top_ups",
  "card_usage_history",
  "service_sessions",
  "service_types",
  "manager_grants",
  "personal_services",
  "personal_sessions",
  "personal_settings",
  "appointments",
  "tasks",
]);
const SERIAL_ENTITY_TYPES = new Set([
  "members",
  "member_versions",
  "attendance",
  "treatment_cards",
  "card_top_ups",
  "service_sessions",
  "service_types",
  "manager_grants",
  "personal_services",
  "personal_sessions",
  "appointments",
  "tasks",
]);
const TABLE_KEY_COLUMN: Record<string, string> = {
  members: "id",
  member_versions: "id",
  attendance: "id",
  treatment_cards: "id",
  card_top_ups: "id",
  card_usage_history: "sourceSessionId",
  service_sessions: "id",
  service_types: "id",
  manager_grants: "id",
  personal_services: "id",
  personal_sessions: "id",
  personal_settings: "user_id",
  appointments: "id",
  tasks: "id",
};
const EVENT_TABLE = "public.storage_partition_events";
const STATE_TABLE = "public.storage_partition_state";
const OPERATIONS_TABLE = "public.storage_partition_operations";
const ID_SEQUENCES_TABLE = "public.storage_partition_id_sequences";
const neonApiKey = process.env.NEON_API_KEY?.trim();
const isPartitionedMode = process.env.DATABASE_STORAGE_MODE === "partitioned";

const configuredNodes = resolveDatabaseNodes(process.env);
const nodes: RuntimeNode[] = configuredNodes.map((node) => ({
  ...node,
  pool: new pg.Pool({
    connectionString: node.url,
    application_name: `so-cong-partition-${node.backend}`,
    max: 2,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  }),
  maxBytes: parseDatabaseCapacityLimit(node.maxBytes) ?? DATABASE_STORAGE_LIMIT_BYTES,
}));
const nodesByBackend = new Map(nodes.map((node) => [node.backend, node]));

let capacityCache = new Map<DatabaseBackend, { expiresAt: number; state: PartitionCapacityState }>();
let coordinatorSchemaReadyUntil = 0;

export class PartitionStorageError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "partition_mode_disabled"
      | "partition_not_configured"
      | "partition_schema_missing"
      | "partition_coordinator_unavailable"
      | "partition_operation_conflict"
      | "partition_operation_incomplete"
      | "partition_entity_invalid",
    public readonly status = 503,
  ) {
    super(message);
    this.name = "PartitionStorageError";
  }
}

export function isPartitionedStorageEnabled(): boolean {
  return isPartitionedMode;
}

export type PartitionedStorageStatus = {
  enabled: boolean;
  strategy: "replication_failover" | "partitioned_forward_only";
  coordinatorBackend: "database_url_4";
  coordinatorReady: boolean | null;
  writeCursor: DatabaseBackend | null;
  nextRevision: string | null;
  eventSchemasReady: boolean | null;
  readsRequireDb1: boolean;
  readsRequireAllStores: boolean;
  storageLimitBytes: string;
  computeLimitHours: number;
  stores: Array<{
    backend: DatabaseBackend;
    configured: boolean;
    capacity: PartitionCapacityState | "not_checked";
    eventJournalReady: boolean | null;
  }>;
  blockers: string[];
};

/** Read-only owner diagnostics; never exposes connection strings or Neon keys. */
export async function getPartitionedStorageStatus(): Promise<PartitionedStorageStatus> {
  const configuredBackends = new Set(nodes.map((node) => node.backend));
  const blockers: string[] = [];
  let coordinatorReady: boolean | null = null;
  let writeCursor: DatabaseBackend | null = null;
  let nextRevision: string | null = null;
  let eventSchemasReady: boolean | null = null;
  const journalReadyByBackend = new Map<DatabaseBackend, boolean | null>(
    BACKEND_ORDER.map((backend) => [backend, null]),
  );

  if (isPartitionedMode) {
    if (nodes.length !== BACKEND_ORDER.length ||
        BACKEND_ORDER.some((backend, index) => nodes[index]?.backend !== backend)) {
      blockers.push("Cần cấu hình đủ bốn kho theo thứ tự DB1 → DB2 → DB3 → DB4.");
    } else {
      try {
        await verifyCoordinatorSchema();
        const journalStates = await Promise.all(nodes.map(async (node) => {
          try {
            await verifyEventSchema(node);
            journalReadyByBackend.set(node.backend, true);
            return true;
          } catch {
            journalReadyByBackend.set(node.backend, false);
            return false;
          }
        }));
        eventSchemasReady = journalStates.filter(Boolean).length >= 3;
        const coordinator = nodesByBackend.get("database_url_4")!;
        const result = await coordinator.pool.query(
          `SELECT write_backend, next_revision::text
           FROM ${STATE_TABLE} WHERE id = 1`,
        );
        const row = result.rows[0];
        if (!row) {
          throw new PartitionStorageError(
            "DB4 partition coordinator has not been initialized.",
            "partition_schema_missing",
          );
        }
        coordinatorReady = true;
        writeCursor = row.write_backend as DatabaseBackend;
        nextRevision = String(row.next_revision);
      } catch (error) {
        const known = error instanceof PartitionStorageError ? error : null;
        coordinatorReady = false;
        eventSchemasReady = false;
        blockers.push(
          known?.message ?? "Không xác minh được schema phân vùng hoặc trạng thái điều phối.",
        );
      }
    }
  } else {
    blockers.push("Chế độ phân vùng chưa bật; ứng dụng đang dùng cơ chế failover replication hiện có.");
  }

  const stores = await Promise.all(BACKEND_ORDER.map(async (backend) => {
    const configured = configuredBackends.has(backend);
    const node = nodesByBackend.get(backend);
    let capacity: PartitionCapacityState | "not_checked" = "not_checked";
    if (isPartitionedMode && node) {
      capacity = await checkCapacity(node);
      if (capacity !== "available") {
        blockers.push(capacity === "full"
          ? `${backend} đã đạt giới hạn dung lượng hoặc CU.`
          : capacity === "unavailable"
            ? `${backend} hiện không truy cập được.`
            : `Không xác minh được dung lượng hoặc CU của ${backend}.`);
      }
    }
    return {
      backend,
      configured,
      capacity,
      eventJournalReady: journalReadyByBackend.get(backend) ?? null,
    };
  }));

  if (isPartitionedMode) {
    blockers.push(
      "Đọc cần ít nhất ba kho có nhật ký hoạt động; mỗi lần ghi mới phải có hai bản sao đã xác nhận.",
    );
    if (!configuredBackends.has("database_url_4")) {
      blockers.push("DB4 là bộ điều phối; nếu không truy cập được, ghi mới sẽ bị chặn.");
    }
    if (eventSchemasReady === false) {
      blockers.push("Cần có schema nhật ký trên ít nhất ba kho để đọc đủ dữ liệu khi một kho lỗi.");
    }
  }

  return {
    enabled: isPartitionedMode,
    strategy: isPartitionedMode ? "partitioned_forward_only" : "replication_failover",
    coordinatorBackend: "database_url_4",
    coordinatorReady,
    writeCursor,
    nextRevision,
    eventSchemasReady,
    readsRequireDb1: false,
    readsRequireAllStores: false,
    storageLimitBytes: DATABASE_STORAGE_LIMIT_BYTES.toString(),
    computeLimitHours: DATABASE_COMPUTE_LIMIT_SECONDS / 3600,
    stores,
    blockers,
  };
}

export function hashPartitionRequest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(`${value}n`);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`,
  ).join(",")}}`;
}

export function partitionEntityKey(entityType: string, id: string | number): string {
  if (!/^[a-z][a-z0-9_]*$/.test(entityType)) {
    throw new PartitionStorageError("Invalid partition entity type.", "partition_entity_invalid", 400);
  }
  const normalizedId = String(id).trim();
  if (!normalizedId || normalizedId.length > 200) {
    throw new PartitionStorageError("Invalid partition entity ID.", "partition_entity_invalid", 400);
  }
  return `${entityType}:${encodeURIComponent(normalizedId)}`;
}

export async function withPartitionWriteMutex<T>(
  lockName: string,
  callback: () => Promise<T>,
): Promise<T> {
  if (!/^[a-z][a-z0-9:_-]{0,100}$/.test(lockName)) {
    throw new PartitionStorageError("Invalid partition lock name.", "partition_operation_conflict", 400);
  }
  requireConfiguredNodes();
  await verifyCoordinatorSchema();
  const coordinator = nodesByBackend.get("database_url_4")!;
  const hostname = new URL(coordinator.url).hostname;
  if (/-pooler(?:\.|$)/i.test(hostname)) {
    throw new PartitionStorageError(
      "DB4 must use a direct PostgreSQL connection for cross-store operation locks.",
      "partition_not_configured",
    );
  }
  const client = await coordinator.pool.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended($1, 0))",
      [`so-cong:partition-write:${lockName}`],
    );
    try {
      return await callback();
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
        [`so-cong:partition-write:${lockName}`],
      );
    }
  } finally {
    client.release();
  }
}

function requireConfiguredNodes(): RuntimeNode[] {
  if (!isPartitionedMode) {
    throw new PartitionStorageError(
      "Partitioned storage is not enabled.",
      "partition_mode_disabled",
      409,
    );
  }
  if (
    nodes.length !== BACKEND_ORDER.length ||
    BACKEND_ORDER.some((backend, index) => nodes[index]?.backend !== backend)
  ) {
    throw new PartitionStorageError(
      "Partitioned storage requires all four databases in DB1–DB4 order.",
      "partition_not_configured",
    );
  }
  if (!nodesByBackend.has("database_url_4")) {
    throw new PartitionStorageError(
      "DB4 coordinator is not configured.",
      "partition_not_configured",
    );
  }
  return nodes;
}

async function verifyEventSchema(node: RuntimeNode): Promise<void> {
  try {
    const result = await node.pool.query(
      `SELECT to_regclass($1) AS events,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'storage_partition_events'
            AND column_name = 'committed'
        ) AS has_commit_marker`,
      [EVENT_TABLE],
    );
    if (!result.rows[0]?.events || result.rows[0]?.has_commit_marker !== true) {
      throw new PartitionStorageError(
        `Partition event schema is incomplete on ${node.backend}.`,
        "partition_schema_missing",
      );
    }
  } catch (error) {
    if (error instanceof PartitionStorageError) throw error;
    throw new PartitionStorageError(
      `Partition event schema could not be verified on ${node.backend}.`,
      "partition_schema_missing",
    );
  }
}

async function verifyCoordinatorSchema(): Promise<void> {
  const now = Date.now();
  if (coordinatorSchemaReadyUntil > now) return;
  requireConfiguredNodes();
  try {
    const coordinator = nodesByBackend.get("database_url_4")!;
    const coordinatorResult = await coordinator.pool.query(
      `SELECT
        to_regclass($1) AS state,
        to_regclass($2) AS operations,
        to_regclass($3) AS sequences`,
      [STATE_TABLE, OPERATIONS_TABLE, ID_SEQUENCES_TABLE],
    );
    const row = coordinatorResult.rows[0];
    if (!row?.state || !row?.operations || !row?.sequences) {
      throw new PartitionStorageError(
        "DB4 partition coordinator schema is incomplete.",
        "partition_schema_missing",
      );
    }
    coordinatorSchemaReadyUntil = now + 5_000;
  } catch (error) {
    if (error instanceof PartitionStorageError) throw error;
    throw new PartitionStorageError(
      "Partition database schema could not be verified; writes are blocked.",
      "partition_schema_missing",
    );
  }
}

async function readComputeTime(node: RuntimeNode): Promise<number> {
  if (!neonApiKey || !node.projectId) {
    throw new Error(`Neon usage monitoring is not configured for ${node.backend}.`);
  }
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(node.projectId)}`,
    {
      headers: { Authorization: `Bearer ${neonApiKey}` },
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) throw new Error("Neon usage API did not return a successful response.");
  return parseNeonComputeTimeSeconds(await response.json());
}

async function checkCapacity(node: RuntimeNode): Promise<PartitionCapacityState> {
  const cached = capacityCache.get(node.backend);
  if (cached && cached.expiresAt > Date.now()) return cached.state;
  let state: PartitionCapacityState = "unknown";
  try {
    const size = await node.pool.query(
      "SELECT pg_database_size(current_database())::text AS bytes",
    );
    const usedBytes = size.rows[0]?.bytes as string | undefined;
    if (!usedBytes) throw new Error("Storage usage is unavailable.");
    if (hasReachedDatabaseCapacity(usedBytes, node.maxBytes)) {
      state = "full";
    } else {
      const usedComputeSeconds = await readComputeTime(node);
      state = hasReachedComputeTimeLimit(usedComputeSeconds, DATABASE_COMPUTE_LIMIT_SECONDS)
        ? "full"
        : "available";
    }
  } catch (error) {
    state = isDatabaseAvailabilityError(error) ? "unavailable" : "unknown";
  }
  capacityCache.set(node.backend, { expiresAt: Date.now() + 30_000, state });
  return state;
}

function parseReservedOperation(row: Record<string, unknown>): ReservedOperation {
  let result = row.result as { allocatedIds?: IdAllocation; replicaBackend?: DatabaseBackend } | null;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result) as typeof result;
    } catch {
      result = null;
    }
  }
  const targetBackend = row.target_backend as DatabaseBackend;
  const replicaBackend = result?.replicaBackend;
  if (!replicaBackend || replicaBackend === targetBackend || !BACKEND_ORDER.includes(replicaBackend)) {
    throw new PartitionStorageError(
      "Partition operation is missing its verified second copy.",
      "partition_operation_incomplete",
    );
  }
  return {
    operationId: String(row.operation_id),
    requestHash: String(row.request_hash),
    targetBackend,
    replicaBackend,
    revision: String(row.revision),
    expectedEventCount: Number(row.expected_event_count),
    allocatedIds: result?.allocatedIds ?? {},
    state: row.state as ReservedOperation["state"],
  };
}

export async function reservePartitionOperation(input: {
  operationId: string;
  requestHash: string;
  expectedEventCount: number;
  idAllocations: Readonly<Record<string, number>>;
}): Promise<ReservedOperation> {
  requireConfiguredNodes();
  await verifyCoordinatorSchema();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId) ||
    !/^[a-f0-9]{64}$/i.test(input.requestHash) ||
    !Number.isSafeInteger(input.expectedEventCount) ||
    input.expectedEventCount < 1 ||
    input.expectedEventCount > 32767
  ) {
    throw new PartitionStorageError("Invalid partition operation request.", "partition_operation_conflict", 400);
  }
  for (const [entityType, count] of Object.entries(input.idAllocations)) {
    if (!SERIAL_ENTITY_TYPES.has(entityType) || !Number.isSafeInteger(count) || count < 0 || count > 32767) {
      throw new PartitionStorageError("Invalid partition ID allocation request.", "partition_operation_conflict", 400);
    }
  }

  const coordinator = nodesByBackend.get("database_url_4")!;

  const capacity = new Map<DatabaseBackend, PartitionCapacityState>();
  for (const node of nodes) {
    let state = await checkCapacity(node);
    if (state === "available") {
      try {
        await verifyEventSchema(node);
      } catch {
        state = "unavailable";
      }
    }
    capacity.set(node.backend, state);
  }

  const client = await coordinator.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('so-cong:partition-coordinator', 0))",
    );
    const existing = await client.query(
      `SELECT operation_id, request_hash, target_backend, revision::text,
        expected_event_count, result, state
       FROM ${OPERATIONS_TABLE} WHERE operation_id = $1 FOR UPDATE`,
      [input.operationId],
    );
    if (existing.rows[0]) {
      const operation = parseReservedOperation(existing.rows[0]);
      if (operation.requestHash !== input.requestHash) {
        throw new PartitionStorageError(
          "This idempotency key was already used for a different request.",
          "partition_operation_conflict",
          409,
        );
      }
      await client.query("COMMIT");
      return operation;
    }

    const stateResult = await client.query(
      `SELECT write_backend, next_revision::text
       FROM ${STATE_TABLE} WHERE id = 1 FOR UPDATE`,
    );
    const state = stateResult.rows[0];
    if (!state) {
      throw new PartitionStorageError(
        "DB4 partition coordinator has not been initialized.",
        "partition_schema_missing",
      );
    }
    const pair = resolvePartitionWritePair(
      state.write_backend as DatabaseBackend,
      BACKEND_ORDER,
      capacity,
    );
    const targetBackend = pair.primary;
    const replicaBackend = pair.replica;
    const allocatedIds: IdAllocation = {};
    for (const [entityType, count] of Object.entries(input.idAllocations)) {
      if (count === 0) {
        allocatedIds[entityType] = [];
        continue;
      }
      const sequence = await client.query(
        `UPDATE ${ID_SEQUENCES_TABLE}
         SET next_id = next_id + $2, updated_at = now()
         WHERE entity_type = $1 AND next_id + $2 - 1 <= 2147483647
         RETURNING (next_id - $2)::text AS first_id`,
        [entityType, count],
      );
      if (!sequence.rows[0]) {
        throw new PartitionStorageError(
          `Global IDs for ${entityType} are not initialized or are exhausted.`,
          "partition_schema_missing",
        );
      }
      const first = Number(sequence.rows[0].first_id);
      allocatedIds[entityType] = Array.from({ length: count }, (_, index) => first + index);
    }

    const revision = String(state.next_revision);
    await client.query(
      `UPDATE ${STATE_TABLE}
       SET write_backend = $1, next_revision = next_revision + 1, updated_at = now()
       WHERE id = 1`,
      [targetBackend],
    );
    await client.query(
      `INSERT INTO ${OPERATIONS_TABLE}
       (operation_id, target_backend, revision, expected_event_count, state, request_hash, result)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6::jsonb)`,
      [
        input.operationId,
        targetBackend,
        revision,
        input.expectedEventCount,
        input.requestHash,
         JSON.stringify({ allocatedIds, replicaBackend }),
      ],
    );
    await client.query("COMMIT");
    return {
      operationId: input.operationId,
      requestHash: input.requestHash,
      targetBackend,
      replicaBackend,
      revision,
      expectedEventCount: input.expectedEventCount,
      allocatedIds,
      state: "pending",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof PartitionStorageError) throw error;
    throw new PartitionStorageError(
      "DB4 could not safely reserve the partition operation.",
      "partition_coordinator_unavailable",
    );
  } finally {
    client.release();
  }
}

export async function getReservedPartitionOperation(
  operationId: string,
  requestHash: string,
): Promise<ReservedOperation | undefined> {
  requireConfiguredNodes();
  await verifyCoordinatorSchema();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId) ||
    !/^[a-f0-9]{64}$/i.test(requestHash)
  ) {
    throw new PartitionStorageError("Invalid partition operation request.", "partition_operation_conflict", 400);
  }
  const coordinator = nodesByBackend.get("database_url_4")!;
  const result = await coordinator.pool.query(
    `SELECT operation_id, request_hash, target_backend, revision::text,
      expected_event_count, result, state
     FROM ${OPERATIONS_TABLE} WHERE operation_id = $1`,
    [operationId],
  );
  if (!result.rows[0]) return undefined;
  const operation = parseReservedOperation(result.rows[0]);
  if (operation.requestHash !== requestHash) {
    throw new PartitionStorageError(
      "This idempotency key was already used for a different request.",
      "partition_operation_conflict",
      409,
    );
  }
  return operation;
}

function deterministicEventId(operationId: string, index: number): string {
  const bytes = createHash("sha256").update(`${operationId}:${index}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function reconcilePartitionOperation(
  operation: ReservedOperation,
): Promise<ReservedOperation> {
  if (operation.state === "committed") return operation;
  const target = nodesByBackend.get(operation.targetBackend);
  const replica = nodesByBackend.get(operation.replicaBackend);
  const coordinator = nodesByBackend.get("database_url_4");
  if (!target || !replica || !coordinator) {
    throw new PartitionStorageError("Partition operation stores are unavailable.", "partition_not_configured");
  }
  let completeCopies = 0;
  for (const node of [target, replica]) {
    try {
      const result = await node.pool.query(
        `SELECT event_id
         FROM ${EVENT_TABLE}
         WHERE operation_id = $1 AND committed = true
         ORDER BY event_id`,
        [operation.operationId],
      );
      const actual = result.rows.map((row) => String(row.event_id)).sort();
      const expected = Array.from(
        { length: operation.expectedEventCount },
        (_, index) => deterministicEventId(operation.operationId, index),
      ).sort();
      if (actual.length === expected.length &&
          expected.every((eventId, index) => eventId === actual[index])) {
        completeCopies += 1;
      }
    } catch {
      // A store outage is handled by the retry path; it must not hide the other copy.
    }
  }
  if (completeCopies !== 2) return operation;
  const client = await coordinator.pool.connect();
  try {
    await client.query(
      `UPDATE ${OPERATIONS_TABLE}
       SET state = 'committed', error_code = NULL, updated_at = now()
       WHERE operation_id = $1 AND request_hash = $2`,
      [operation.operationId, operation.requestHash],
    );
    return { ...operation, state: "committed" };
  } finally {
    client.release();
  }
}

async function writePendingEventsToNode(
  node: RuntimeNode,
  operation: ReservedOperation,
  events: readonly PartitionMutation[],
): Promise<void> {
  const client = await node.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`so-cong:partition-operation:${operation.operationId}`],
    );
    const existing = await client.query(
      `SELECT event_id FROM ${EVENT_TABLE} WHERE operation_id = $1`,
      [operation.operationId],
    );
    const expectedIds = events.map((event) => event.eventId).sort();
    const existingIds = existing.rows.map((row) => String(row.event_id)).sort();
    const exactReplay = expectedIds.length === existingIds.length &&
      expectedIds.every((eventId, index) => eventId === existingIds[index]);
    if (existing.rows.length !== 0 && !exactReplay) {
      throw new PartitionStorageError(
        `Stored events on ${node.backend} do not match the reserved operation.`,
        "partition_operation_incomplete",
      );
    }
    if (existing.rows.length === 0) {
      for (const event of events) {
        await client.query(
          `INSERT INTO ${EVENT_TABLE}
           (event_id, operation_id, revision, source_backend, entity_type, entity_key, action, payload, committed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, false)`,
          [
            event.eventId,
            event.operationId,
            event.revision,
            operation.targetBackend,
            event.entityType,
            event.entityKey,
            event.action,
            event.payload === null ? null : JSON.stringify(event.payload),
          ],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendReservedPartitionOperation(
  operation: ReservedOperation,
  mutations: readonly MutationDraft[],
): Promise<void> {
  requireConfiguredNodes();
  await verifyCoordinatorSchema();
  operation = await reconcilePartitionOperation(operation);
  if (operation.state === "committed") return;
  if (mutations.length !== operation.expectedEventCount) {
    throw new PartitionStorageError(
      "Partition mutation count does not match its reserved operation.",
      "partition_operation_conflict",
      409,
    );
  }
  const target = nodesByBackend.get(operation.targetBackend);
  const replica = nodesByBackend.get(operation.replicaBackend);
  const coordinator = nodesByBackend.get("database_url_4")!;
  if (!target || !replica) {
    throw new PartitionStorageError("Reserved database is not configured.", "partition_not_configured");
  }
  const persistCommitted = async () => {
    try {
      for (const node of [target, replica]) {
        const marked = await node.pool.query(
          `UPDATE ${EVENT_TABLE} SET committed = true
           WHERE operation_id = $1 RETURNING event_id`,
          [operation.operationId],
        );
        if (marked.rows.length !== operation.expectedEventCount) {
          throw new Error(`Incomplete event copy on ${node.backend}.`);
        }
      }
      const committed = await coordinator.pool.query(
        `UPDATE ${OPERATIONS_TABLE}
         SET state = 'committed', error_code = NULL, updated_at = now()
         WHERE operation_id = $1 AND request_hash = $2`,
        [operation.operationId, operation.requestHash],
      );
      if (committed.rowCount !== 1) {
        throw new Error("DB4 operation journal did not confirm the commit.");
      }
    } catch {
      throw new PartitionStorageError(
        "The database write may be committed, but DB4 could not confirm it. Retry with the same operation ID.",
        "partition_operation_incomplete",
      );
    }
  };
  const reroute = async (
    failedBackend: DatabaseBackend,
    failedState: "full" | "unavailable",
    errorCode: string,
  ): Promise<ReservedOperation> => {
    const capacity = new Map<DatabaseBackend, PartitionCapacityState>();
    for (const node of nodes) {
      let state = await checkCapacity(node);
      if (state === "available") {
        try {
          await verifyEventSchema(node);
        } catch {
          state = "unavailable";
        }
      }
      capacity.set(node.backend, state);
    }
    capacity.set(failedBackend, failedState);
    let nextPair: ReturnType<typeof resolvePartitionWritePair>;
    try {
      nextPair = resolvePartitionWritePair(
      operation.targetBackend,
      BACKEND_ORDER,
      capacity,
      );
    } catch {
      throw new PartitionStorageError(
        "Two verified writable stores are not available for this operation.",
        "partition_operation_incomplete",
      );
    }
    if (nextPair.primary === operation.targetBackend &&
        nextPair.replica === operation.replicaBackend) {
      throw new PartitionStorageError(
        "No alternate two-store route is available for this operation.",
        "partition_operation_incomplete",
      );
    }
    const client = await coordinator.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('so-cong:partition-coordinator', 0))",
      );
      const current = await client.query(
        `SELECT state, target_backend, request_hash
         FROM ${OPERATIONS_TABLE} WHERE operation_id = $1 FOR UPDATE`,
        [operation.operationId],
      );
      const row = current.rows[0];
      if (!row || row.request_hash !== operation.requestHash || row.state === "committed") {
        throw new PartitionStorageError(
          "Partition operation state changed; retry the same operation ID.",
          "partition_operation_conflict",
          409,
        );
      }
      await client.query(
        `UPDATE ${OPERATIONS_TABLE}
         SET target_backend = $2,
             result = coalesce(result, '{}'::jsonb) || jsonb_build_object('replicaBackend', $3),
             state = 'pending', error_code = $4, updated_at = now()
         WHERE operation_id = $1`,
        [operation.operationId, nextPair.primary, nextPair.replica, errorCode],
      );
      const stateResult = await client.query(
        `SELECT write_backend FROM ${STATE_TABLE} WHERE id = 1 FOR UPDATE`,
      );
      const cursor = stateResult.rows[0]?.write_backend as DatabaseBackend | undefined;
      if (cursor && BACKEND_ORDER.indexOf(nextPair.primary) > BACKEND_ORDER.indexOf(cursor)) {
        await client.query(
          `UPDATE ${STATE_TABLE} SET write_backend = $1, updated_at = now() WHERE id = 1`,
          [nextPair.primary],
        );
      }
      await client.query("COMMIT");
      return {
        ...operation,
        targetBackend: nextPair.primary,
        replicaBackend: nextPair.replica,
        state: "pending",
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof PartitionStorageError) throw error;
      throw new PartitionStorageError(
        "DB4 could not safely route this operation to the next store.",
        "partition_coordinator_unavailable",
      );
    } finally {
      client.release();
    }
  };

  const events: PartitionMutation[] = mutations.map((mutation, index) => {
    if (!BASE_TABLES.has(mutation.entityType)) {
      throw new PartitionStorageError("Unsupported partition entity type.", "partition_entity_invalid", 400);
    }
    const encodedId = mutation.entityKey.startsWith(`${mutation.entityType}:`)
      ? mutation.entityKey.slice(mutation.entityType.length + 1)
      : "";
    let decodedId = "";
    try {
      decodedId = decodeURIComponent(encodedId);
    } catch {
      throw new PartitionStorageError("Partition entity key is invalid.", "partition_entity_invalid", 400);
    }
    const expectedKey = partitionEntityKey(
      mutation.entityType,
      mutation.payload?.[TABLE_KEY_COLUMN[mutation.entityType]!] as string | number ?? decodedId,
    );
    if (expectedKey !== mutation.entityKey) {
      throw new PartitionStorageError("Partition entity key does not match its payload.", "partition_entity_invalid", 400);
    }
    if (
      (mutation.action !== "upsert" && mutation.action !== "delete") ||
      (mutation.action === "delete" && mutation.payload !== null) ||
      (mutation.action === "upsert" && mutation.payload === null)
    ) {
      throw new PartitionStorageError("Partition mutation action and payload do not match.", "partition_entity_invalid", 400);
    }
    return {
      ...mutation,
      eventId: deterministicEventId(operation.operationId, index),
      operationId: operation.operationId,
      revision: operation.revision,
    };
  });

  const writableState = async (node: RuntimeNode): Promise<PartitionCapacityState> => {
    const state = await checkCapacity(node);
    if (state !== "available") return state;
    try {
      await verifyEventSchema(node);
      return "available";
    } catch {
      return "unavailable";
    }
  };
  const targetCapacity = await writableState(target);
  if (targetCapacity === "full" || targetCapacity === "unavailable") {
    const next = await reroute(target.backend, targetCapacity, `target_${targetCapacity}`);
    return appendReservedPartitionOperation(next, mutations);
  }
  if (targetCapacity === "unknown") {
    throw new PartitionStorageError(
      `Capacity for ${target.backend} could not be verified; writes are blocked.`,
      "partition_operation_incomplete",
    );
  }
  const replicaCapacity = await writableState(replica);
  if (replicaCapacity === "full" || replicaCapacity === "unavailable") {
    const next = await reroute(replica.backend, replicaCapacity, `replica_${replicaCapacity}`);
    return appendReservedPartitionOperation(next, mutations);
  }
  if (replicaCapacity === "unknown") {
    throw new PartitionStorageError(
      `Capacity for ${replica.backend} could not be verified; a second copy cannot be confirmed.`,
      "partition_operation_incomplete",
    );
  }

  let existingCount: number;
  try {
    const result = await target.pool.query(
      `SELECT count(*)::int AS count FROM ${EVENT_TABLE} WHERE operation_id = $1`,
      [operation.operationId],
    );
    existingCount = Number(result.rows[0]?.count ?? 0);
  } catch {
    throw new PartitionStorageError(
      "The reserved database outcome could not be verified; retry with the same operation ID.",
      "partition_operation_incomplete",
    );
  }
  if (existingCount === operation.expectedEventCount) {
    try {
      await writePendingEventsToNode(replica, operation, events);
    } catch (error) {
      const failedState = isDatabaseCapacityError(error)
        ? "full"
        : isDatabaseAvailabilityError(error)
          ? "unavailable"
          : undefined;
      if (failedState) {
        const next = await reroute(replica.backend, failedState, `replica_${failedState}`);
        return appendReservedPartitionOperation(next, mutations);
      }
      throw error;
    }
    await persistCommitted();
    return;
  }
  if (existingCount !== 0) {
    throw new PartitionStorageError(
      "A partial partition operation requires reconciliation; it will not be replayed.",
      "partition_operation_incomplete",
    );
  }
  const targetClient = await target.pool.connect();
  let targetCommitted = false;
  let writeError: unknown;
  try {
    await targetClient.query("BEGIN");
    await targetClient.query("SET LOCAL statement_timeout = '20s'");
    await targetClient.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`so-cong:partition-operation:${operation.operationId}`],
    );
    const existing = await targetClient.query(
      `SELECT event_id FROM ${EVENT_TABLE} WHERE operation_id = $1`,
      [operation.operationId],
    );
    const expectedIds = events.map((event) => event.eventId).sort();
    const existingIds = existing.rows.map((row) => String(row.event_id)).sort();
    const exactReplay = expectedIds.length === existingIds.length &&
      expectedIds.every((eventId, index) => eventId === existingIds[index]);
    if (existing.rows.length !== 0 && !exactReplay) {
      throw new PartitionStorageError(
        "Stored events do not match the reserved operation; reconciliation is required.",
        "partition_operation_incomplete",
      );
    }
    if (existing.rows.length === 0) {
      for (const event of events) {
        await targetClient.query(
          `INSERT INTO ${EVENT_TABLE}
           (event_id, operation_id, revision, source_backend, entity_type, entity_key, action, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            event.eventId,
            event.operationId,
            event.revision,
            operation.targetBackend,
            event.entityType,
            event.entityKey,
            event.action,
            event.payload === null ? null : JSON.stringify(event.payload),
          ],
        );
      }
    }
    await targetClient.query("COMMIT");
    targetCommitted = true;
  } catch (error) {
    writeError = error;
    await targetClient.query("ROLLBACK").catch(() => undefined);
  } finally {
    targetClient.release();
  }

  if (writeError) {
    let postFailureCount: number | undefined;
    try {
      const result = await target.pool.query(
        `SELECT count(*)::int AS count FROM ${EVENT_TABLE} WHERE operation_id = $1`,
        [operation.operationId],
      );
      postFailureCount = Number(result.rows[0]?.count ?? 0);
    } catch {
      // An unreachable target might have committed; moving it would risk duplication.
    }
    if (postFailureCount === operation.expectedEventCount) {
      try {
        await writePendingEventsToNode(replica, operation, events);
      } catch (error) {
        const failedState = isDatabaseCapacityError(error)
          ? "full"
          : isDatabaseAvailabilityError(error)
            ? "unavailable"
            : undefined;
        if (failedState) {
          const next = await reroute(replica.backend, failedState, `replica_${failedState}`);
          return appendReservedPartitionOperation(next, mutations);
        }
        throw error;
      }
      await persistCommitted();
      return;
    }
    const failedState = isDatabaseCapacityError(writeError)
      ? "full"
      : isDatabaseAvailabilityError(writeError)
        ? "unavailable"
        : undefined;
    if (postFailureCount === 0 && failedState) {
      const next = await reroute(target.backend, failedState, `target_${failedState}`);
      return appendReservedPartitionOperation(next, mutations);
    }
    const client = await coordinator.pool.connect();
    try {
      await client.query(
        `UPDATE ${OPERATIONS_TABLE}
         SET state = 'needs_reconciliation', error_code = $2, updated_at = now()
         WHERE operation_id = $1 AND state <> 'committed'`,
        [operation.operationId, writeError instanceof PartitionStorageError ? writeError.code : "target_write_failed"],
      );
    } catch {
      // The committed target transaction, if any, is resolved by the idempotent retry.
    } finally {
      client.release();
    }
    throw writeError;
  }

  if (!targetCommitted) return;
  try {
    await writePendingEventsToNode(replica, operation, events);
  } catch (error) {
    const failedState = isDatabaseCapacityError(error)
      ? "full"
      : isDatabaseAvailabilityError(error)
        ? "unavailable"
        : undefined;
    if (failedState) {
      const next = await reroute(replica.backend, failedState, `replica_${failedState}`);
      return appendReservedPartitionOperation(next, mutations);
    }
    throw error;
  }
  await persistCommitted();
}

function normalizeEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeEventPayload);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" &&
      /(?:At|Date)$/.test(key) &&
      /^\d{4}-\d{2}-\d{2}T/.test(item)
    ) {
      result[key] = new Date(item);
    } else {
      result[key] = normalizeEventPayload(item);
    }
  }
  return result;
}

export async function readPartitionedTable<T extends Record<string, unknown>>(
  tableName: string,
): Promise<T[]> {
  requireConfiguredNodes();
  const keyColumn = TABLE_KEY_COLUMN[tableName];
  if (!keyColumn || !BASE_TABLES.has(tableName)) {
    throw new PartitionStorageError("Unsupported partition table.", "partition_entity_invalid", 400);
  }
  const availableNodes: RuntimeNode[] = [];
  const mutationsById = new Map<string, PartitionMutation>();
  for (const node of nodes) {
    try {
      const result = await node.pool.query(
        `SELECT event_id, operation_id, revision::text, entity_type, entity_key, action, payload
         FROM ${EVENT_TABLE}
         WHERE committed = true AND entity_type = $1
         ORDER BY revision ASC, event_id ASC`,
        [tableName],
      );
      availableNodes.push(node);
      for (const row of result.rows) {
        const mutation: PartitionMutation = {
          eventId: String(row.event_id),
          operationId: String(row.operation_id),
          revision: String(row.revision),
          entityType: String(row.entity_type),
          entityKey: String(row.entity_key),
          action: row.action,
          payload: row.payload === null ? null : normalizeEventPayload(row.payload) as Record<string, unknown>,
        };
        const existing = mutationsById.get(mutation.eventId);
        if (existing && stableJson(existing) !== stableJson(mutation)) {
          throw new PartitionStorageError(
            "Replicated event copies differ; read is stopped to avoid returning inconsistent data.",
            "partition_operation_incomplete",
          );
        }
        mutationsById.set(mutation.eventId, mutation);
      }
    } catch (error) {
      if (error instanceof PartitionStorageError) throw error;
      // An unavailable or not-yet-migrated store is treated as one failed replica.
    }
  }
  if (availableNodes.length < 3) {
    throw new PartitionStorageError(
      "Fewer than three event stores are readable; complete history cannot be guaranteed after one-store failure.",
      "partition_operation_incomplete",
    );
  }

  let rows: pg.QueryResult | undefined;
  let baseReadSucceeded = false;
  for (const node of availableNodes) {
    try {
      rows = await node.pool.query(`SELECT * FROM public."${tableName}"`);
      baseReadSucceeded = true;
      break;
    } catch (error) {
      void error;
    }
  }
  if (!baseReadSucceeded) {
    throw new PartitionStorageError(
      "No healthy store can provide the canonical base data.",
      "partition_operation_incomplete",
    );
  }
  const baseRows = new Map<string, T>();
  for (const row of rows!.rows as T[]) {
    const key = partitionEntityKey(tableName, row[keyColumn] as string | number);
    baseRows.set(key, row);
  }

  const { applyPartitionMutations } = await import("./storage-partitioning");
  return [...applyPartitionMutations(baseRows, [...mutationsById.values()]).values()];
}
