import { createHash } from "node:crypto";
import pg from "pg";
import { AdvisoryLockReleaseError, withReentrantAdvisoryLock } from "./reentrant-advisory-lock";
import { createAsyncMutex } from "./async-mutex";
import { normalizePartitionDatabaseRow, personalTableReadPredicates } from "./partitioned-row";
import { PartitionReadCache } from "./partition-read-cache";
import { isDatabaseAvailabilityError, isDatabaseCapacityError } from "./failover-utils";
import {
  buildPartitionEventInsertBatch,
  type PartitionMutation,
} from "./storage-partitioning";
import {
  getDomainAvailabilityFallbackRoutes,
  getPartitionActionEntityTypes,
  getPreferredDomainWriteRoutes,
  type DomainWriteRoute,
} from "./domain-partitioning";
import {
  resolveDatabaseNodes,
  type DatabaseBackend,
  type DatabaseNodeConfig,
} from "./failover-topology";

type RuntimeNode = Omit<DatabaseNodeConfig, "maxBytes"> & { pool: pg.Pool };
type IdAllocation = Record<string, number[]>;
export type ReservedOperation = {
  operationId: string;
  requestHash: string;
  targetBackend: DatabaseBackend;
  replicaBackend: DatabaseBackend;
  revision: string;
  expectedEventCount: number;
  allocatedIds: IdAllocation;
  routeEntityTypes?: string[];
  domainEntityTypes?: string[];
  domainRoutes?: Record<string, DomainWriteRoute>;
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
  "employee_availability",
  "facility_bonus_settings",
  "employee_service_bonus_rates",
  "facility_night_settings",
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
  personal_settings: "userId",
  appointments: "id",
  employee_availability: "memberId",
  facility_bonus_settings: "id",
  employee_service_bonus_rates: "id",
  facility_night_settings: "id",
  tasks: "id",
};
const TABLE_DB_KEY_COLUMN: Record<string, string> = {
  ...TABLE_KEY_COLUMN,
  card_usage_history: "source_session_id",
  personal_settings: "user_id",
  employee_availability: "member_id",
};
const LEGACY_DEFAULT_BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const EVENT_TABLE = "public.storage_partition_events";
const STATE_TABLE = "public.storage_partition_state";
const OPERATIONS_TABLE = "public.storage_partition_operations";
const ID_SEQUENCES_TABLE = "public.storage_partition_id_sequences";
const isDomainPartitionedMode = ["domain_partitioned", "partitioned"].includes(
  process.env.DATABASE_STORAGE_MODE ?? "",
);
const isPartitionedMode = isDomainPartitionedMode;

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
}));
const nodesByBackend = new Map(nodes.map((node) => [node.backend, node]));

const partitionReadCache = new PartitionReadCache(3_000);
let coordinatorSchemaReadyUntil = 0;
const withLocalPartitionWriteMutex = createAsyncMutex();

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
  strategy: "replication_failover" | "partitioned_by_domain";
  coordinatorBackend: "database_url_4";
  coordinatorReady: boolean | null;
  writeCursor: DatabaseBackend | null;
  nextRevision: string | null;
  eventSchemasReady: boolean | null;
  readsRequireDb1: boolean;
  readsRequireAllStores: boolean;
  stores: Array<{
    backend: DatabaseBackend;
    configured: boolean;
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

  const stores = BACKEND_ORDER.map((backend) => {
    const configured = configuredBackends.has(backend);
    return {
      backend,
      configured,
      eventJournalReady: journalReadyByBackend.get(backend) ?? null,
    };
  });

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
    strategy: isPartitionedMode ? "partitioned_by_domain" : "replication_failover",
    coordinatorBackend: "database_url_4",
    coordinatorReady,
    writeCursor,
    nextRevision,
    eventSchemasReady,
    readsRequireDb1: false,
    readsRequireAllStores: false,
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

export function partitionEntityKey(entityType: string, id: string | number, businessId?: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(entityType)) {
    throw new PartitionStorageError("Invalid partition entity type.", "partition_entity_invalid", 400);
  }
  const normalizedId = String(
    businessId && businessId !== LEGACY_DEFAULT_BUSINESS_ID &&
      ["facility_bonus_settings", "facility_night_settings"].includes(entityType)
      ? `${businessId}:${id}`
      : id,
  ).trim();
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
  return withLocalPartitionWriteMutex(async () => {
    const client = await coordinator.pool.connect();
    let discardClient = false;
    try {
      return await withReentrantAdvisoryLock(client, lockName, callback);
    } catch (error) {
      if (error instanceof AdvisoryLockReleaseError) {
        discardClient = true;
        throw error.operationError ?? error;
      }
      throw error;
    } finally {
      client.release(discardClient ? true : undefined);
    }
  });
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
        ) AS has_commit_marker,
        EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE schemaname = 'public' AND tablename = 'storage_partition_events'
        ) AS published,
        EXISTS (
          SELECT 1
          FROM pg_subscription_rel sr
          JOIN pg_class c ON c.oid = sr.srrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'storage_partition_events'
        ) AS subscribed`,
      [EVENT_TABLE],
    );
    if (!result.rows[0]?.events || result.rows[0]?.has_commit_marker !== true) {
      throw new PartitionStorageError(
        `Partition event schema is incomplete on ${node.backend}.`,
        "partition_schema_missing",
      );
    }
    if (result.rows[0]?.published === true || result.rows[0]?.subscribed === true) {
      throw new PartitionStorageError(
        `Partition journal replication must be disabled for ${node.backend}; otherwise the two-copy writes can conflict.`,
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

function parseReservedOperation(row: Record<string, unknown>): ReservedOperation {
  let result = row.result as {
    allocatedIds?: IdAllocation;
    replicaBackend?: DatabaseBackend;
    routeEntityTypes?: string[];
    domainEntityTypes?: string[];
    domainRoutes?: Record<string, DomainWriteRoute>;
  } | null;
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
  if (result?.domainRoutes) {
    for (const [table, route] of Object.entries(result.domainRoutes)) {
      if (
        !BASE_TABLES.has(table) ||
        !route ||
        !BACKEND_ORDER.includes(route.primary) ||
        !BACKEND_ORDER.includes(route.replica) ||
        route.primary === route.replica ||
        !["facility", "cards", "personal", "shared"].includes(route.domain)
      ) {
        throw new PartitionStorageError(
          "Partition operation has an invalid data-domain route.",
          "partition_operation_incomplete",
        );
      }
    }
  }
  return {
    operationId: String(row.operation_id),
    requestHash: String(row.request_hash),
    targetBackend,
    replicaBackend,
    revision: String(row.revision),
    expectedEventCount: Number(row.expected_event_count),
    allocatedIds: result?.allocatedIds ?? {},
    ...(result?.routeEntityTypes ? { routeEntityTypes: result.routeEntityTypes } : {}),
    ...(result?.domainEntityTypes ? { domainEntityTypes: result.domainEntityTypes } : {}),
    ...(result?.domainRoutes ? { domainRoutes: result.domainRoutes } : {}),
    state: row.state as ReservedOperation["state"],
  };
}

export async function reservePartitionOperation(input: {
  operationId: string;
  requestHash: string;
  action?: string;
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
      `SELECT next_revision::text
       FROM ${STATE_TABLE} WHERE id = 1 FOR UPDATE`,
    );
    const state = stateResult.rows[0];
    if (!state) {
      throw new PartitionStorageError(
        "DB4 partition coordinator has not been initialized.",
        "partition_schema_missing",
      );
    }
    const actionEntityTypes = input.action ? getPartitionActionEntityTypes(input.action) : undefined;
    if (!actionEntityTypes?.length) {
      throw new PartitionStorageError(
        "The operation has no approved data-domain route.",
        "partition_entity_invalid",
        400,
      );
    }
    const routeEntityTypes = [...new Set(actionEntityTypes)];
    const domainRoutes = getPreferredDomainWriteRoutes(routeEntityTypes);
    const firstRoute = domainRoutes[routeEntityTypes[0]!];
    if (!firstRoute) {
      throw new PartitionStorageError(
        "The operation has no approved data-domain route.",
        "partition_entity_invalid",
        400,
      );
    }
    const targetBackend = firstRoute.primary;
    const replicaBackend = firstRoute.replica;
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
        JSON.stringify({
          allocatedIds,
          replicaBackend,
          ...(domainRoutes ? { domainRoutes, routeEntityTypes } : {}),
        }),
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
      ...(domainRoutes ? { domainRoutes, routeEntityTypes } : {}),
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

function groupDomainEntityTypes(
  entityTypes: readonly string[],
  routes: Record<string, DomainWriteRoute>,
): Array<{ primary: DatabaseBackend; replica: DatabaseBackend; entityTypes: string[] }> {
  const groups = new Map<string, { primary: DatabaseBackend; replica: DatabaseBackend; entityTypes: string[] }>();
  for (const entityType of entityTypes) {
    const route = routes[entityType];
    if (!route) {
      throw new PartitionStorageError(
        `No data-domain route exists for ${entityType}.`,
        "partition_operation_incomplete",
      );
    }
    const key = `${route.primary}:${route.replica}`;
    const group = groups.get(key) ?? {
      primary: route.primary,
      replica: route.replica,
      entityTypes: [],
    };
    group.entityTypes.push(entityType);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function persistDomainRoutePlan(
  operation: ReservedOperation,
  entityTypes: string[],
  routes: Record<string, DomainWriteRoute>,
): Promise<ReservedOperation> {
  const firstRoute = routes[entityTypes[0]!];
  if (!firstRoute) {
    throw new PartitionStorageError("The operation has no data-domain route.", "partition_operation_incomplete");
  }
  const coordinator = nodesByBackend.get("database_url_4")!;
  const replicaBackend = firstRoute.replica;
  const saved = await coordinator.pool.query(
    `UPDATE ${OPERATIONS_TABLE}
     SET target_backend = $2,
         result = coalesce(result, '{}'::jsonb) ||
           jsonb_build_object(
             'replicaBackend', $3,
             'domainRoutes', $4::jsonb,
             'domainEntityTypes', $5::jsonb
           ),
         state = 'pending', updated_at = now()
     WHERE operation_id = $1 AND request_hash = $6 AND state <> 'committed'`,
    [
      operation.operationId,
      firstRoute.primary,
      replicaBackend,
      JSON.stringify(routes),
      JSON.stringify(entityTypes),
      operation.requestHash,
    ],
  );
  if (saved.rowCount !== 1) {
    throw new PartitionStorageError(
      "DB4 could not save the data-domain routing decision.",
      "partition_coordinator_unavailable",
    );
  }
  return {
    ...operation,
    targetBackend: firstRoute.primary,
    replicaBackend,
    domainEntityTypes: entityTypes,
    domainRoutes: routes,
    state: "pending",
  };
}

async function writeDomainEventsToNode(
  node: RuntimeNode,
  operation: ReservedOperation,
  events: readonly PartitionMutation[],
): Promise<void> {
  if (!events.length) return;
  const client = await node.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`so-cong:partition-operation:${operation.operationId}`],
    );
    const entityTypes = [...new Set(events.map((event) => event.entityType))];
    const existing = await client.query(
      `SELECT event_id FROM ${EVENT_TABLE}
       WHERE operation_id = $1 AND entity_type = ANY($2::text[])`,
      [operation.operationId, entityTypes],
    );
    const expectedIds = events.map((event) => event.eventId).sort();
    const existingIds = existing.rows.map((row) => String(row.event_id)).sort();
    const exactReplay = expectedIds.length === existingIds.length &&
      expectedIds.every((eventId, index) => eventId === existingIds[index]);
    if (existing.rows.length !== 0 && !exactReplay) {
      throw new PartitionStorageError(
        `Stored data-domain events on ${node.backend} do not match the reserved operation.`,
        "partition_operation_incomplete",
      );
    }
    if (existing.rows.length === 0) {
      const batch = buildPartitionEventInsertBatch(events);
      const sourceBackends = events.map((event) => {
        const route = operation.domainRoutes?.[event.entityType];
        if (!route) {
          throw new PartitionStorageError(
            `No data-domain route exists for ${event.entityType}.`,
            "partition_operation_incomplete",
          );
        }
        return route.primary;
      });
      await client.query(
        `INSERT INTO ${EVENT_TABLE}
         (event_id, operation_id, revision, source_backend, entity_type, entity_key, action, payload, committed)
         SELECT rows.event_id, rows.operation_id, rows.revision, rows.source_backend,
           rows.entity_type, rows.entity_key, rows.action, rows.payload, false
         FROM unnest(
           $1::uuid[], $2::uuid[], $3::bigint[], $4::text[], $5::text[],
           $6::text[], $7::text[], $8::jsonb[]
         ) AS rows(event_id, operation_id, revision, source_backend, entity_type, entity_key, action, payload)`,
        [
          batch.eventIds,
          batch.operationIds,
          batch.revisions,
          sourceBackends,
          batch.entityTypes,
          batch.entityKeys,
          batch.actions,
          batch.payloads,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function reconcileDomainPartitionOperation(
  operation: ReservedOperation,
): Promise<ReservedOperation> {
  const entityTypes = operation.domainEntityTypes;
  const routes = operation.domainRoutes;
  if (!entityTypes?.length || !routes) return operation;
  const groups = groupDomainEntityTypes(entityTypes, routes);
  const eventIds = new Set<string>();
  for (const group of groups) {
    const primary = nodesByBackend.get(group.primary);
    const replica = nodesByBackend.get(group.replica);
    if (!primary || !replica) return operation;
    try {
      const [primaryRows, replicaRows] = await Promise.all([
        primary.pool.query(
          `SELECT event_id, entity_type FROM ${EVENT_TABLE}
           WHERE operation_id = $1 AND entity_type = ANY($2::text[]) AND committed = true
           ORDER BY event_id`,
          [operation.operationId, group.entityTypes],
        ),
        replica.pool.query(
          `SELECT event_id, entity_type FROM ${EVENT_TABLE}
           WHERE operation_id = $1 AND entity_type = ANY($2::text[]) AND committed = true
           ORDER BY event_id`,
          [operation.operationId, group.entityTypes],
        ),
      ]);
      const primaryIds = primaryRows.rows.map((row) => String(row.event_id));
      const replicaIds = replicaRows.rows.map((row) => String(row.event_id));
      if (
        primaryIds.length !== replicaIds.length ||
        primaryIds.some((id, index) => id !== replicaIds[index])
      ) return operation;
      for (const id of primaryIds) {
        if (eventIds.has(id)) return operation;
        eventIds.add(id);
      }
    } catch {
      return operation;
    }
  }
  const expected = Array.from(
    { length: operation.expectedEventCount },
    (_, index) => deterministicEventId(operation.operationId, index),
  ).sort();
  const actual = [...eventIds].sort();
  if (actual.length !== expected.length ||
      expected.some((eventId, index) => eventId !== actual[index])) return operation;
  const coordinator = nodesByBackend.get("database_url_4")!;
  const result = await coordinator.pool.query(
    `UPDATE ${OPERATIONS_TABLE}
     SET state = 'committed', error_code = NULL, updated_at = now()
     WHERE operation_id = $1 AND request_hash = $2`,
    [operation.operationId, operation.requestHash],
  );
  if (result.rowCount !== 1) return operation;
  partitionReadCache.clear();
  return { ...operation, state: "committed" };
}

export async function reconcilePartitionOperation(
  operation: ReservedOperation,
): Promise<ReservedOperation> {
  if (operation.state === "committed") return operation;
  if (isDomainPartitionedMode && operation.domainRoutes && operation.domainEntityTypes) {
    return reconcileDomainPartitionOperation(operation);
  }
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
    partitionReadCache.clear();
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
      const batch = buildPartitionEventInsertBatch(events);
      await client.query(
        `INSERT INTO ${EVENT_TABLE}
         (event_id, operation_id, revision, source_backend, entity_type, entity_key, action, payload, committed)
         SELECT rows.event_id, rows.operation_id, rows.revision, $4,
           rows.entity_type, rows.entity_key, rows.action, rows.payload, false
         FROM unnest(
           $1::uuid[], $2::uuid[], $3::bigint[], $5::text[], $6::text[],
           $7::text[], $8::jsonb[]
         ) AS rows(event_id, operation_id, revision, entity_type, entity_key, action, payload)`,
        [
          batch.eventIds,
          batch.operationIds,
          batch.revisions,
          operation.targetBackend,
          batch.entityTypes,
          batch.entityKeys,
          batch.actions,
          batch.payloads,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function appendDomainPartitionOperation(
  originalOperation: ReservedOperation,
  events: readonly PartitionMutation[],
  mutations: readonly MutationDraft[],
  fallbackDepth = 0,
): Promise<void> {
  const actionTypes = new Set(originalOperation.routeEntityTypes ?? []);
  const entityTypes = [...new Set(events.map((event) => event.entityType))].sort();
  if (
    !entityTypes.length ||
    entityTypes.some((entityType) => !actionTypes.has(entityType))
  ) {
    throw new PartitionStorageError(
      "The operation contains a table outside its approved data-domain route.",
      "partition_entity_invalid",
      400,
    );
  }
  if (
    originalOperation.domainEntityTypes &&
    (originalOperation.domainEntityTypes.length !== entityTypes.length ||
      originalOperation.domainEntityTypes.some((entityType, index) => entityType !== entityTypes[index]))
  ) {
    throw new PartitionStorageError(
      "A retry attempted to change the operation's data-domain tables.",
      "partition_operation_conflict",
      409,
    );
  }

  let operation = originalOperation;
  let routes = originalOperation.domainRoutes ?? {};
  if (!originalOperation.domainEntityTypes) {
    routes = getPreferredDomainWriteRoutes(entityTypes);
    operation = await persistDomainRoutePlan(operation, entityTypes, routes);
  }

  const nodeEvents = new Map<DatabaseBackend, PartitionMutation[]>();
  for (const event of events) {
    const route = routes[event.entityType];
    if (!route) {
      throw new PartitionStorageError(
        `No data-domain route exists for ${event.entityType}.`,
        "partition_operation_incomplete",
      );
    }
    for (const backend of [route.primary, route.replica]) {
      const rows = nodeEvents.get(backend) ?? [];
      rows.push(event);
      nodeEvents.set(backend, rows);
    }
  }

  let failedBackend: DatabaseBackend | undefined;
  try {
    for (const [backend, nodeEventsForBackend] of nodeEvents) {
      const node = nodesByBackend.get(backend);
      if (!node) {
        throw new PartitionStorageError("A routed database is not configured.", "partition_not_configured");
      }
      failedBackend = backend;
      await writeDomainEventsToNode(node, operation, nodeEventsForBackend);
    }
  } catch (error) {
    if (
      failedBackend &&
      fallbackDepth === 0 &&
      !isDatabaseCapacityError(error) &&
      isDatabaseAvailabilityError(error)
    ) {
      try {
        const rerouted = await rerouteDomainPartitionOperation(
          operation,
          entityTypes,
          failedBackend,
        );
        return appendDomainPartitionOperation(rerouted, events, mutations, 1);
      } catch (rerouteError) {
        if (rerouteError instanceof PartitionStorageError) error = rerouteError;
      }
    }
    const coordinator = nodesByBackend.get("database_url_4")!;
    await coordinator.pool.query(
      `UPDATE ${OPERATIONS_TABLE}
       SET state = 'needs_reconciliation', error_code = $2, updated_at = now()
       WHERE operation_id = $1 AND state <> 'committed'`,
      [
        operation.operationId,
        error instanceof PartitionStorageError ? error.code : "domain_event_write_failed",
      ],
    ).catch(() => undefined);
    if (error instanceof PartitionStorageError) throw error;
    if (isDatabaseCapacityError(error)) {
      throw new PartitionStorageError(
        "Kho đã hết dung lượng. Dữ liệu chưa được xác nhận và không tự chuyển sang kho khác; hãy nâng cấp kho này rồi thử lại bằng cùng thao tác.",
        "partition_operation_incomplete",
      );
    }
    throw new PartitionStorageError(
      "Không thể xác nhận bản sao của phân vùng. Chỉ lỗi kết nối thật mới thử cặp dự phòng một lần; nếu kho đầy, không tự chuyển kho. Khắc phục rồi thử lại bằng cùng mã thao tác.",
      "partition_operation_incomplete",
    );
  }

  try {
    for (const [backend, expectedEvents] of nodeEvents) {
      const node = nodesByBackend.get(backend)!;
      const eventIds = expectedEvents.map((event) => event.eventId);
      const marked = await node.pool.query(
        `UPDATE ${EVENT_TABLE} SET committed = true
         WHERE operation_id = $1 AND event_id = ANY($2::uuid[])
         RETURNING event_id`,
        [operation.operationId, eventIds],
      );
      if (marked.rows.length !== eventIds.length) {
        throw new Error(`Incomplete committed event copy on ${backend}.`);
      }
    }
    const coordinator = nodesByBackend.get("database_url_4")!;
    const committed = await coordinator.pool.query(
      `UPDATE ${OPERATIONS_TABLE}
       SET state = 'committed', error_code = NULL, updated_at = now()
       WHERE operation_id = $1 AND request_hash = $2`,
      [operation.operationId, operation.requestHash],
    );
    if (committed.rowCount !== 1) throw new Error("DB4 did not confirm the operation.");
    partitionReadCache.invalidate(mutations.map((mutation) => mutation.entityType));
  } catch {
    throw new PartitionStorageError(
      "The write may be present, but completion could not be confirmed. Retry with the same operation ID.",
      "partition_operation_incomplete",
    );
  }
}

async function rerouteDomainPartitionOperation(
  operation: ReservedOperation,
  entityTypes: string[],
  failedBackend: DatabaseBackend,
): Promise<ReservedOperation> {
  let routes: Record<string, DomainWriteRoute>;
  try {
    routes = getDomainAvailabilityFallbackRoutes(
      entityTypes,
      failedBackend,
      operation.domainRoutes,
    );
  } catch {
    throw new PartitionStorageError(
      "Không tìm được cặp kho dự phòng cho lỗi kết nối; thao tác được giữ lại để thử lại.",
      "partition_operation_incomplete",
    );
  }
  const current = operation.domainRoutes ?? {};
  if (entityTypes.every((entityType) => {
    const previous = current[entityType];
    const next = routes[entityType];
    return previous?.primary === next?.primary && previous?.replica === next?.replica;
  })) {
    throw new PartitionStorageError(
      "Cặp kho hiện tại vẫn được giữ; không có tuyến thay thế cho lỗi kết nối này.",
      "partition_operation_incomplete",
    );
  }
  return persistDomainRoutePlan(operation, entityTypes, routes);
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
      partitionReadCache.invalidate(mutations.map((mutation) => mutation.entityType));
    } catch {
      throw new PartitionStorageError(
        "The database write may be committed, but DB4 could not confirm it. Retry with the same operation ID.",
        "partition_operation_incomplete",
      );
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
  if (isDomainPartitionedMode && operation.routeEntityTypes?.length) {
    return appendDomainPartitionOperation(operation, events, mutations);
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
    await writePendingEventsToNode(replica, operation, events);
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
      await writePendingEventsToNode(replica, operation, events);
      await persistCommitted();
      return;
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
  await writePendingEventsToNode(replica, operation, events);
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
  filter?: { ids?: number[]; email?: string; grantedBy?: string; userId?: string; businessId?: string },
): Promise<T[]> {
  requireConfiguredNodes();
  const keyColumn = TABLE_KEY_COLUMN[tableName];
  if (!keyColumn || !BASE_TABLES.has(tableName)) {
    throw new PartitionStorageError("Unsupported partition table.", "partition_entity_invalid", 400);
  }
  if (filter && tableName !== "manager_grants" && (filter.email !== undefined || filter.grantedBy !== undefined)) {
    throw new PartitionStorageError("Email filters are supported only for manager grants.", "partition_entity_invalid", 400);
  }
  if (filter?.userId !== undefined &&
      !["personal_services", "personal_sessions", "personal_settings"].includes(tableName)) {
    throw new PartitionStorageError("User filters are supported only for personal notebook tables.", "partition_entity_invalid", 400);
  }
  if (filter?.businessId !== undefined &&
      ["personal_services", "personal_sessions", "personal_settings", "api_write_operations"].includes(tableName)) {
    throw new PartitionStorageError("Business filters are supported only for facility tables.", "partition_entity_invalid", 400);
  }
  if (filter?.ids && !["members", "service_sessions", "attendance", "manager_grants", "card_usage_history", "employee_availability"].includes(tableName)) {
    throw new PartitionStorageError("ID filters are not supported for this table.", "partition_entity_invalid", 400);
  }
  const filterKey = stableJson(filter ?? {});
  const cachedRows = partitionReadCache.get<T>(tableName, filterKey);
  if (cachedRows) return cachedRows;
  const eventConditions: string[] = [];
  const eventParams: unknown[] = [tableName];
  const addEventParam = (condition: (placeholder: string) => string, value: unknown) => {
    eventParams.push(value);
    eventConditions.push(condition(`$${eventParams.length}`));
  };
  if (filter?.ids) addEventParam((p) => `entity_key = ANY(${p}::text[])`,
    filter.ids.map((id) => partitionEntityKey(tableName, id)));
  if (filter?.email) addEventParam((p) => `entity_key IN (SELECT entity_key FROM ${EVENT_TABLE}
    WHERE committed = true AND entity_type = $1 AND payload->>'email' = ${p})`, filter.email);
  if (filter?.grantedBy) addEventParam((p) => `entity_key IN (SELECT entity_key FROM ${EVENT_TABLE}
    WHERE committed = true AND entity_type = $1 AND payload->>'grantedBy' = ${p})`, filter.grantedBy);
  if (filter?.userId !== undefined) addEventParam(
    (p) => `entity_key IN (SELECT entity_key FROM ${EVENT_TABLE}
      WHERE committed = true AND entity_type = $1 AND payload->>'userId' = ${p})`,
    filter.userId,
  );
  if (filter?.businessId) {
    const isLegacyDefault = filter.businessId === LEGACY_DEFAULT_BUSINESS_ID;
    addEventParam((p) => `entity_key IN (SELECT entity_key FROM ${EVENT_TABLE}
      WHERE committed = true AND entity_type = $1 AND
        (payload->>'businessId' = ${p}${isLegacyDefault ? " OR payload->>'businessId' IS NULL" : ""}))`,
    filter.businessId);
  }
  const eventFilter = eventConditions.map((condition) => `AND ${condition}`).join("\n");
  const dbKeyColumn = TABLE_DB_KEY_COLUMN[tableName]!;
  const baseConditions: string[] = [];
  const baseParams: unknown[] = [];
  const addBaseParam = (column: string, value: unknown, cast = "") => {
    baseParams.push(value);
    baseConditions.push(`"${column}" = $${baseParams.length}${cast}`);
  };
  if (filter?.ids) {
    baseParams.push(filter.ids);
    baseConditions.push(`"${dbKeyColumn}" = ANY($${baseParams.length}::integer[])`);
  }
  if (filter?.email) addBaseParam("email", filter.email);
  if (filter?.grantedBy) addBaseParam("granted_by", filter.grantedBy);
  if (filter?.userId !== undefined) addBaseParam("user_id", filter.userId);
  if (filter?.businessId) addBaseParam("business_id", filter.businessId);
  const baseQuery = `SELECT * FROM public."${tableName}"${
    baseConditions.length ? ` WHERE ${baseConditions.join(" AND ")}` : ""
  }`;
  const availableNodes: RuntimeNode[] = [];
  const mutationsById = new Map<string, PartitionMutation>();
  const eventReads = await Promise.all(nodes.map(async (node) => {
    try {
      return {
        node,
        result: await node.pool.query(
          `SELECT event_id, operation_id, revision::text, entity_type, entity_key, action, payload
           FROM ${EVENT_TABLE}
           WHERE committed = true AND entity_type = $1
           ${eventFilter}
           ORDER BY revision ASC, event_id ASC`,
          eventParams,
        ),
      };
    } catch {
      return null;
    }
  }));
  for (const read of eventReads) {
    if (!read) continue;
    availableNodes.push(read.node);
    for (const row of read.result.rows) {
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
  }
  if (availableNodes.length < 3) {
    throw new PartitionStorageError(
      "Fewer than three event stores are readable; complete history cannot be guaranteed after one-store failure.",
      "partition_operation_incomplete",
    );
  }

  const baseReads = await Promise.all(availableNodes.map(async (node) => {
    try {
      return await node.pool.query(baseQuery, baseParams);
    } catch {
      return null;
    }
  }));
  const rows = baseReads.find((result): result is pg.QueryResult => result !== null);
  if (!rows) {
    throw new PartitionStorageError(
      "No healthy store can provide the canonical base data.",
      "partition_operation_incomplete",
    );
  }
  const baseRows = new Map<string, T>();
  for (const rawRow of rows.rows as Record<string, unknown>[]) {
    const row = normalizePartitionDatabaseRow(rawRow) as T;
    const key = partitionEntityKey(
      tableName,
      row[keyColumn] as string | number,
      typeof row.businessId === "string" ? row.businessId : undefined,
    );
    baseRows.set(key, row);
  }

  const { applyPartitionMutations } = await import("./storage-partitioning");
  const result = [...applyPartitionMutations(baseRows, [...mutationsById.values()]).values()];
  partitionReadCache.set(tableName, filterKey, result);
  return result;
}

export async function readPartitionedRowById<T extends Record<string, unknown>>(
  tableName: string,
  id: number,
  businessId?: string,
): Promise<T | undefined> {
  const rows = await readPartitionedTable<T>(tableName, { ids: [id], ...(businessId ? { businessId } : {}) });
  return rows[0];
}

export async function readPartitionedGrantByEmail<T extends Record<string, unknown>>(
  email: string,
  businessId?: string,
): Promise<T | undefined> {
  const rows = await readPartitionedTable<T>("manager_grants", { email, ...(businessId ? { businessId } : {}) });
  return rows[0];
}

export async function readPartitionedGrantsByGrantor<T extends Record<string, unknown>>(
  email: string,
  businessId?: string,
): Promise<T[]> {
  return readPartitionedTable<T>("manager_grants", { grantedBy: email, ...(businessId ? { businessId } : {}) });
}
