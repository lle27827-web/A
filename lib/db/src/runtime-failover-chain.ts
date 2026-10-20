import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  DATABASE_COMPUTE_LIMIT_SECONDS,
  DATABASE_STORAGE_LIMIT_BYTES,
  hasReachedComputeTimeLimit,
  hasReachedDatabaseCapacity,
  isDatabaseAvailabilityError,
  isDatabaseCapacityError,
  isDatabaseFailoverTriggerError,
  isSameDatabaseFailureDomain,
  parseDatabaseCapacityLimit,
  parseNeonComputeTimeSeconds,
} from "./failover-utils";
import {
  areAdjacentBackends,
  failoverStateConstraintSupports,
  getBackendIndex,
  getNextBackend,
  getReplicationEdge,
  isPersistedDatabaseBackend,
  replicationTableSetsMatch,
  resolveDatabaseNodes,
  type DatabaseBackend,
  type DatabaseNodeConfig,
  type PersistedDatabaseBackend,
} from "./failover-topology";
import {
  planSequenceSync,
  type SequenceSnapshot,
} from "./failover-sequences";
import { describeReplicationBlocker } from "./failover-replication-readiness";

type Queryable = { query: (...args: any[]) => any };
type RuntimeNode = Omit<DatabaseNodeConfig, "maxBytes"> & {
  pool: pg.Pool;
  subscriptionPool: pg.Pool;
  canManageSubscription: boolean;
  database: ReturnType<typeof drizzle<typeof schema>>;
  maxBytes: bigint;
};
type FailoverReason = "availability" | "compute" | "storage" | "manual";

const isVercel = process.env.VERCEL === "1";
const configuredNodes = resolveDatabaseNodes(process.env);
const databaseUrl = process.env.DATABASE_URL?.trim();
const failoverCoordinatorUrl =
  process.env.DATABASE_FAILOVER_COORDINATOR_URL?.trim();
const failoverEnabled =
  isVercel &&
  Boolean(process.env.DATABASE_URL_1?.trim() && databaseUrl) &&
  configuredNodes.length >= 2;
const stateBackend: DatabaseBackend = "database_url";
const neonApiKey = process.env.NEON_API_KEY?.trim();

function usesNeonPooler(connectionString: string): boolean {
  try {
    return /-pooler(?:\.|$)/i.test(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

if (isVercel && process.env.DATABASE_URL_1?.trim() && !databaseUrl) {
  throw new Error(
    "DATABASE_URL must remain set as the fallback for DATABASE_URL_1.",
  );
}

const nodes: RuntimeNode[] = configuredNodes.map((node) => {
  const maxBytes =
    parseDatabaseCapacityLimit(node.maxBytes) ??
    DATABASE_STORAGE_LIMIT_BYTES;
  const pool = new pg.Pool({
    connectionString: node.url,
    application_name: node.applicationName,
    max: 2,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
  });
  const subscriptionPool = node.adminUrl
    ? new pg.Pool({
        connectionString: node.adminUrl,
        application_name: `${node.applicationName}-subscription-admin`,
        max: 1,
        connectionTimeoutMillis: 15_000,
        idleTimeoutMillis: 10_000,
      })
    : pool;
  return {
    ...node,
    pool,
    subscriptionPool,
    canManageSubscription:
      Boolean(node.adminUrl) || !usesNeonPooler(node.url),
    database: drizzle(pool, { schema }),
    maxBytes,
  };
});

if (
  failoverCoordinatorUrl &&
  nodes.some((node) =>
    isSameDatabaseFailureDomain(failoverCoordinatorUrl, node.url),
  )
) {
  throw new Error(
    "DATABASE_FAILOVER_COORDINATOR_URL must use a separate database failure domain from all application databases.",
  );
}

const failoverCoordinatorPool = failoverCoordinatorUrl
  ? new pg.Pool({
      connectionString: failoverCoordinatorUrl,
      application_name: "so-cong-failover-coordinator",
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
    })
  : undefined;

if (failoverEnabled) {
  if (!failoverCoordinatorPool) {
    console.warn(
      "[db-failover] DATABASE_FAILOVER_COORDINATOR_URL is not configured; using the legacy failover-state table on DATABASE_URL. Failover cannot be coordinated if that database is unavailable.",
    );
  } else {
    console.info(
      "[db-failover] Using the independent PostgreSQL failover coordinator.",
    );
  }
  for (const node of nodes) {
    if (!node.projectId) {
      console.warn(
        `[db-failover] ${node.backend} is configured without its Neon project ID; it cannot be promoted automatically.`,
      );
    }
    if (node !== nodes[0] && !node.canManageSubscription) {
      console.warn(
        `[db-failover] ${node.backend} uses a Neon pooler URL without a direct subscription-admin URL; promotion is blocked.`,
      );
    }
  }
  if (!neonApiKey) {
    console.warn(
      "[db-failover] Neon CU-hour monitoring is unavailable until NEON_API_KEY and every configured project ID are set; API requests will fail closed.",
    );
  }
}

let activeBackend: PersistedDatabaseBackend = failoverEnabled
  ? (nodes[0]?.backend ?? "database_url")
  : "database_url";
let activeDatabase: RuntimeNode["database"] | undefined =
  nodeForBackend("database_url")?.database ?? nodes[0]?.database;
let lastCapacityCheckAt = 0;
let lastCapacityCheckBackend: DatabaseBackend | null = null;
let capacityCheckPromise: Promise<void> | null = null;
let failoverPromise: Promise<boolean> | null = null;
let lastAvailabilityFailoverAttemptAt = 0;

const lsnPollIntervalMs = 250;
const lsnPollAttempts = 40;
const transactionDrainAttempts = 12;

function nodeForBackend(backend: DatabaseBackend): RuntimeNode | undefined {
  return nodes.find((node) => node.backend === backend);
}

function activeNode(): RuntimeNode | undefined {
  if (activeBackend === "switching") return undefined;
  return nodeForBackend(activeBackend);
}

function controlNode(): RuntimeNode | undefined {
  return nodeForBackend(stateBackend);
}

function failoverStatePool(): pg.Pool | undefined {
  return failoverCoordinatorPool ?? controlNode()?.pool;
}

function setActiveBackend(backend: PersistedDatabaseBackend): void {
  activeBackend = backend;
  if (backend === "switching") {
    activeDatabase = undefined;
    return;
  }
  activeDatabase = nodeForBackend(backend)?.database;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function" &&
    typeof (value as { catch?: unknown }).catch === "function"
  );
}

function queryText(args: any[]): string {
  const first = args[0];
  if (typeof first === "string") return first;
  if (first && typeof first.text === "string") return first.text;
  return "";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBackendState(): Promise<PersistedDatabaseBackend> {
  if (!failoverEnabled) return nodes[0]?.backend ?? "database_url";

  const statePool = failoverStatePool();
  if (!statePool) {
    throw new Error("The database failover state database is not configured.");
  }
  const result = await statePool.query(
    "SELECT active_backend FROM public.db_failover_state WHERE id = 1",
  );
  const backend = result.rows[0]?.active_backend;
  if (!isPersistedDatabaseBackend(backend)) {
    throw new Error(
      "Database failover state is missing or has an unsupported value.",
    );
  }
  if (backend !== "switching" && !nodeForBackend(backend)) {
    throw new Error(
      `Database failover state points to ${backend}, but its URL is not configured.`,
    );
  }
  return backend;
}

async function stateConstraintAllows(
  backend: DatabaseBackend,
): Promise<boolean> {
  const statePool = failoverStatePool();
  if (!statePool) return false;
  try {
    const result = await statePool.query(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'public.db_failover_state'::regclass
         AND conname = 'db_failover_state_active_backend_check'`,
    );
    const definition = result.rows[0]?.definition as string | undefined;
    return failoverStateConstraintSupports(definition, [backend]);
  } catch {
    return false;
  }
}

async function getReplicationReadiness(
  publisher: RuntimeNode,
  subscriber: RuntimeNode,
): Promise<{ ready: boolean; message: string }> {
  const edge = getReplicationEdge(publisher.backend, subscriber.backend);
  if (!edge) {
    return {
      ready: false,
      message: describeReplicationBlocker({ kind: "edge_missing" }),
    };
  }

  try {
    const [subscription, subscriptionTables, publishedTables, publisherTables] =
      await Promise.all([
      subscriber.pool.query(
        `SELECT subenabled
         FROM pg_subscription
         WHERE subname = $1`,
        [edge.subscriptionName],
      ),
      subscriber.pool.query(
        `SELECT n.nspname AS schema_name,
                c.relname AS table_name,
                r.srsubstate = 'r' AS ready
         FROM pg_subscription_rel r
         JOIN pg_subscription s ON s.oid = r.srsubid
         JOIN pg_class c ON c.oid = r.srrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE s.subname = $1`,
        [edge.subscriptionName],
      ),
      publisher.pool.query(
        `SELECT schemaname AS schema_name,
                tablename AS table_name
         FROM pg_publication_tables
         WHERE pubname = $1
         ORDER BY schemaname, tablename`,
        [edge.publicationName],
      ),
      publisher.pool.query(
        `SELECT n.nspname AS schema_name,
                c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind IN ('r', 'p')
           AND c.relname <> 'db_failover_state'
         ORDER BY n.nspname, c.relname`,
      ),
    ]);

    const expectedTables = publisherTables.rows.map(
      (row: { schema_name: string; table_name: string }) => ({
        schemaName: row.schema_name,
        tableName: row.table_name,
      }),
    );
    const publishedTableSet = publishedTables.rows.map(
      (row: { schema_name: string; table_name: string }) => ({
        schemaName: row.schema_name,
        tableName: row.table_name,
      }),
    );
    const subscriptionTableSet = subscriptionTables.rows.map(
      (row: { schema_name: string; table_name: string }) => ({
        schemaName: row.schema_name,
        tableName: row.table_name,
      }),
    );

    const subscriptionStatus = subscription.rows[0] as
      | { subenabled: boolean }
      | undefined;
    if (!subscriptionStatus) {
      return {
        ready: false,
        message: describeReplicationBlocker({
          kind: "subscription_missing",
          subscriptionName: edge.subscriptionName,
        }),
      };
    }
    if (!subscriptionStatus.subenabled) {
      return {
        ready: false,
        message: describeReplicationBlocker({
          kind: "subscription_disabled",
          subscriptionName: edge.subscriptionName,
        }),
      };
    }
    if (expectedTables.length === 0) {
      return {
        ready: false,
        message: describeReplicationBlocker({ kind: "no_application_tables" }),
      };
    }

    const tableKey = (table: { schemaName: string; tableName: string }) =>
      `${table.schemaName}\u0000${table.tableName}`;
    const expectedKeys = new Set(expectedTables.map(tableKey));
    const publicationKeys = new Set(publishedTableSet.map(tableKey));
    if (!replicationTableSetsMatch(expectedTables, publishedTableSet)) {
      return {
        ready: false,
        message: describeReplicationBlocker({
          kind: "publication_mismatch",
          missingTables: expectedTables.filter(
            (table: { schemaName: string; tableName: string }) =>
              !publicationKeys.has(tableKey(table)),
          ),
          hasExtraTables: publishedTableSet.some(
            (table: { schemaName: string; tableName: string }) =>
              !expectedKeys.has(tableKey(table)),
          ),
        }),
      };
    }

    const subscriptionKeys = new Set(subscriptionTableSet.map(tableKey));
    if (!replicationTableSetsMatch(expectedTables, subscriptionTableSet)) {
      return {
        ready: false,
        message: describeReplicationBlocker({
          kind: "subscription_mismatch",
          missingTables: expectedTables.filter(
            (table: { schemaName: string; tableName: string }) =>
              !subscriptionKeys.has(tableKey(table)),
          ),
          hasExtraTables: subscriptionTableSet.some(
            (table: { schemaName: string; tableName: string }) =>
              !expectedKeys.has(tableKey(table)),
          ),
        }),
      };
    }

    const pendingTables = subscriptionTables.rows
      .filter((row: { ready: boolean }) => !row.ready)
      .map((row: { schema_name: string; table_name: string }) => ({
        schemaName: row.schema_name,
        tableName: row.table_name,
      }));
    if (pendingTables.length > 0) {
      return {
        ready: false,
        message: describeReplicationBlocker({
          kind: "pending_tables",
          tables: pendingTables,
        }),
      };
    }

    const [lastEnd, current] = await Promise.all([
      subscriber.pool.query(
        `SELECT latest_end_lsn::text AS lsn
         FROM pg_stat_subscription
         WHERE subname = $1
           AND worker_type = 'apply'
         LIMIT 1`,
        [edge.subscriptionName],
      ),
      publisher.pool.query(
        "SELECT pg_current_wal_lsn()::text AS lsn",
      ),
    ]);
    const appliedLsn = lastEnd.rows[0]?.lsn as string | undefined;
    const currentLsn = current.rows[0]?.lsn as string | undefined;
    if (!appliedLsn) {
      return {
        ready: false,
        message: describeReplicationBlocker({
          kind: "apply_worker_missing",
          subscriptionName: edge.subscriptionName,
        }),
      };
    }
    if (!currentLsn) {
      return {
        ready: false,
        message: describeReplicationBlocker({ kind: "lsn_missing" }),
      };
    }

    const difference = await subscriber.pool.query(
      `SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::text AS lag_bytes`,
      [currentLsn, appliedLsn],
    );
    const lagBytes = Number(difference.rows[0]?.lag_bytes);
    if (!Number.isFinite(lagBytes)) {
      return {
        ready: false,
        message: describeReplicationBlocker({ kind: "lsn_missing" }),
      };
    }
    if (lagBytes > 0) {
      return {
        ready: false,
        message: describeReplicationBlocker({
          kind: "lag",
          bytes: String(Math.ceil(lagBytes)),
        }),
      };
    }
    return { ready: true, message: "Đã đồng bộ; có thể chuyển an toàn." };
  } catch {
    return {
      ready: false,
      message: describeReplicationBlocker({ kind: "query_failed" }),
    };
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function qualifiedIdentifier(schema: string, name: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function applicationTables(node: RuntimeNode): Promise<
  { schemaName: string; tableName: string }[]
> {
  const result = await node.pool.query(
    `SELECT n.nspname AS schema_name,
            c.relname AS table_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relname <> 'db_failover_state'
     ORDER BY n.nspname, c.relname`,
  );
  return result.rows.map(
    (row: { schema_name: string; table_name: string }) => ({
      schemaName: row.schema_name,
      tableName: row.table_name,
    }),
  );
}

async function ensureReplicationPublication(
  publisher: RuntimeNode,
  publicationName: string,
): Promise<boolean> {
  try {
    const publication = await publisher.subscriptionPool.query(
      `SELECT puballtables, pubinsert, pubupdate, pubdelete, pubtruncate
       FROM pg_publication
       WHERE pubname = $1`,
      [publicationName],
    );
    const expectedTables = await applicationTables(publisher);
    if (expectedTables.length === 0) return false;

    if (publication.rows.length === 0) {
      const tableList = expectedTables
        .map(({ schemaName, tableName }) =>
          qualifiedIdentifier(schemaName, tableName),
        )
        .join(", ");
      await publisher.subscriptionPool.query(
        `CREATE PUBLICATION ${quoteIdentifier(publicationName)}
         FOR TABLE ${tableList}`,
      );
    } else {
      const current = publication.rows[0];
      if (
        current.puballtables ||
        !current.pubinsert ||
        !current.pubupdate ||
        !current.pubdelete ||
        !current.pubtruncate
      ) {
        return false;
      }
    }

    const [published, localTables] = await Promise.all([
      publisher.pool.query(
        `SELECT schemaname AS schema_name,
                tablename AS table_name
         FROM pg_publication_tables
         WHERE pubname = $1
         ORDER BY schemaname, tablename`,
        [publicationName],
      ),
      applicationTables(publisher),
    ]);
    return replicationTableSetsMatch(
      localTables,
      published.rows.map(
        (row: { schema_name: string; table_name: string }) => ({
          schemaName: row.schema_name,
          tableName: row.table_name,
        }),
      ),
    );
  } catch {
    return false;
  }
}

async function removeSubscription(
  subscriber: RuntimeNode,
  subscriptionName: string,
): Promise<boolean> {
  try {
    const result = await subscriber.subscriptionPool.query(
      `SELECT subenabled
       FROM pg_subscription
       WHERE subname = $1`,
      [subscriptionName],
    );
    if (result.rows.length === 0) return true;
    if (result.rows[0]?.subenabled) {
      await subscriber.subscriptionPool.query(
        `ALTER SUBSCRIPTION ${quoteIdentifier(subscriptionName)} DISABLE`,
      );
    }
    await subscriber.subscriptionPool.query(
      `DROP SUBSCRIPTION ${quoteIdentifier(subscriptionName)}`,
    );
    return true;
  } catch {
    return false;
  }
}

async function readSubscriptionEnabled(
  subscriber: RuntimeNode,
  subscriptionName: string,
): Promise<boolean | null> {
  try {
    const result = await subscriber.subscriptionPool.query(
      `SELECT subenabled
       FROM pg_subscription
       WHERE subname = $1`,
      [subscriptionName],
    );
    return result.rows.length === 0 ? false : result.rows[0]?.subenabled === true;
  } catch {
    return null;
  }
}

async function createFreshSubscription(
  publisher: RuntimeNode,
  subscriber: RuntimeNode,
  publicationName: string,
  subscriptionName: string,
): Promise<boolean> {
  if (!publisher.canManageSubscription || !subscriber.canManageSubscription) {
    return false;
  }
  if (!(await ensureReplicationPublication(publisher, publicationName))) {
    return false;
  }

  try {
    const existing = await subscriber.subscriptionPool.query(
      `SELECT subenabled
       FROM pg_subscription
       WHERE subname = $1`,
      [subscriptionName],
    );
    if (existing.rows[0]?.subenabled) return false;
    if (
      existing.rows.length > 0 &&
      !(await removeSubscription(subscriber, subscriptionName))
    ) {
      return false;
    }

    const connectionString = publisher.adminUrl ?? publisher.url;
    await subscriber.subscriptionPool.query(
      `CREATE SUBSCRIPTION ${quoteIdentifier(subscriptionName)}
       CONNECTION ${quoteLiteral(connectionString)}
       PUBLICATION ${quoteIdentifier(publicationName)}
       WITH (copy_data = false)`,
    );
    return true;
  } catch {
    return false;
  }
}

async function readSequenceSnapshots(node: RuntimeNode): Promise<SequenceSnapshot[]> {
  const sequences = await node.pool.query(
    `SELECT sequence_ns.nspname AS sequence_schema,
            seq.relname AS sequence_name,
            table_ns.nspname AS table_schema,
            tbl.relname AS table_name,
            attr.attname AS column_name,
            cfg.seqstart::text AS start_value,
            cfg.seqincrement::text AS increment_by,
            cfg.seqmin::text AS min_value,
            cfg.seqmax::text AS max_value,
            cfg.seqcycle AS cycle
     FROM pg_class seq
     JOIN pg_namespace sequence_ns ON sequence_ns.oid = seq.relnamespace
     JOIN pg_sequence cfg ON cfg.seqrelid = seq.oid
     JOIN pg_depend dep
       ON dep.classid = 'pg_class'::regclass
      AND dep.objid = seq.oid
      AND dep.refclassid = 'pg_class'::regclass
      AND dep.deptype IN ('a', 'i')
     JOIN pg_class tbl ON tbl.oid = dep.refobjid
     JOIN pg_namespace table_ns ON table_ns.oid = tbl.relnamespace
     JOIN pg_attribute attr
       ON attr.attrelid = tbl.oid
      AND attr.attnum = dep.refobjsubid
      AND NOT attr.attisdropped
     WHERE seq.relkind = 'S'
       AND sequence_ns.nspname = 'public'
       AND table_ns.nspname = 'public'
     ORDER BY table_ns.nspname, tbl.relname, attr.attname`,
  );

  return Promise.all(
    sequences.rows.map(async (row: Record<string, unknown>) => {
      const sequenceSchema = String(row.sequence_schema);
      const sequenceName = String(row.sequence_name);
      const tableSchema = String(row.table_schema);
      const tableName = String(row.table_name);
      const columnName = String(row.column_name);
      const [cursor, max] = await Promise.all([
        node.pool.query(
          `SELECT last_value::text AS last_value, is_called
           FROM ${qualifiedIdentifier(sequenceSchema, sequenceName)}`,
        ),
        node.pool.query(
          `SELECT max(${quoteIdentifier(columnName)})::text AS max_value
           FROM ${qualifiedIdentifier(tableSchema, tableName)}`,
        ),
      ]);

      return {
        sequenceSchema,
        sequenceName,
        tableSchema,
        tableName,
        columnName,
        startValue: String(row.start_value),
        incrementBy: String(row.increment_by),
        minValue: String(row.min_value),
        maxValue: String(row.max_value),
        cycle: row.cycle === true,
        lastValue: cursor.rows[0]?.last_value ?? null,
        isCalled: cursor.rows[0]?.is_called === true,
        tableMaxValue: max.rows[0]?.max_value ?? null,
      };
    }),
  );
}

async function synchronizeSequences(
  publisher: RuntimeNode,
  subscriber: RuntimeNode,
): Promise<boolean> {
  try {
    const [sourceSequences, targetSequences] = await Promise.all([
      readSequenceSnapshots(publisher),
      readSequenceSnapshots(subscriber),
    ]);
    const updates = planSequenceSync(sourceSequences, targetSequences);
    if (!updates) return false;

    for (const update of updates) {
      await subscriber.pool.query(
        "SELECT setval($1::regclass, $2::bigint, $3::boolean)",
        [
          qualifiedIdentifier(update.sequenceSchema, update.sequenceName),
          update.value,
          update.isCalled,
        ],
      );
    }
    return true;
  } catch {
    return false;
  }
}

async function waitForReplicationCatchup(
  publisher: RuntimeNode,
  subscriber: RuntimeNode,
): Promise<boolean> {
  for (let attempt = 0; attempt < lsnPollAttempts; attempt += 1) {
    if ((await getReplicationReadiness(publisher, subscriber)).ready) return true;
    await delay(lsnPollIntervalMs);
  }
  return false;
}

async function waitForTransactionsToDrain(node: RuntimeNode): Promise<boolean> {
  let idleChecks = 0;
  for (let attempt = 0; attempt < transactionDrainAttempts; attempt += 1) {
    try {
      const result = await node.pool.query(
        `SELECT count(*)::int AS active
         FROM pg_stat_activity
         WHERE pid <> pg_backend_pid()
           AND datname = current_database()
           AND backend_type = 'client backend'
           AND application_name = $1
           AND xact_start IS NOT NULL`,
        [node.applicationName],
      );
      if (result.rows[0]?.active === 0) {
        idleChecks += 1;
        if (idleChecks >= 2) return true;
      } else {
        idleChecks = 0;
      }
    } catch {
      return false;
    }
    await delay(lsnPollIntervalMs);
  }
  return false;
}

async function readComputeUsageSeconds(node: RuntimeNode): Promise<number> {
  if (!neonApiKey || !node.projectId) {
    throw new Error(`Neon project ID is missing for ${node.backend}.`);
  }
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(node.projectId)}`,
    {
      headers: { Authorization: `Bearer ${neonApiKey}` },
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Neon usage API returned HTTP ${response.status}.`);
  }
  return parseNeonComputeTimeSeconds(await response.json());
}

async function nodeHasCapacity(node: RuntimeNode): Promise<boolean> {
  try {
    const size = await node.pool.query(
      "SELECT pg_database_size(current_database())::text AS bytes",
    );
    const usedBytes = size.rows[0]?.bytes as string | undefined;
    if (!usedBytes || hasReachedDatabaseCapacity(usedBytes, node.maxBytes)) {
      return false;
    }
    const usedComputeSeconds = await readComputeUsageSeconds(node);
    return !hasReachedComputeTimeLimit(usedComputeSeconds);
  } catch {
    return false;
  }
}

let cascadingReplicationCheck: {
  expiresAt: number;
  result: Promise<boolean>;
} | null = null;

async function supportsCascadingReplication(): Promise<boolean> {
  if (nodes.length <= 2) return true;
  const now = Date.now();
  if (!cascadingReplicationCheck || cascadingReplicationCheck.expiresAt <= now) {
    const result = Promise.all(
      nodes.map(async (node) => {
        const versionResult = await node.pool.query(
          "SELECT current_setting('server_version_num')::int AS version",
        );
        return Number(versionResult.rows[0]?.version);
      }),
    )
      .then((versions) =>
        versions.every(
          (version) => Number.isInteger(version) && version >= 160000,
        ),
      )
      .catch(() => false);
    cascadingReplicationCheck = {
      expiresAt: now + 5 * 60_000,
      result,
    };
  }
  return cascadingReplicationCheck.result;
}

async function restoreBackendAfterBlockedFailover(
  backend: DatabaseBackend,
  reason: string,
): Promise<void> {
  const statePool = failoverStatePool();
  if (!statePool) throw new Error("The failover state database is unavailable.");
  const result = await statePool.query(
    `UPDATE public.db_failover_state
     SET active_backend = $1,
         reason = $2,
         updated_at = now()
     WHERE id = 1 AND active_backend = 'switching'`,
    [backend, reason],
  );
  if (result.rowCount !== 1) {
    const latest = await readBackendState().catch(() => "switching" as const);
    setActiveBackend(latest);
    if (latest === "switching") {
      throw new Error("The failover state could not be safely restored.");
    }
    return;
  }
  setActiveBackend(backend);
}

function failoverReasonMessage(reason: FailoverReason, backend: DatabaseBackend): string {
  if (reason === "manual") return `Owner requested a controlled switch from ${backend}.`;
  if (reason === "compute") return `100 CU-hour limit reached on ${backend}.`;
  if (reason === "availability") return `Database connection or write availability failed on ${backend}.`;
  return `Storage limit reached on ${backend}.`;
}

type ReplicationFlipResult = {
  ready: boolean;
  safeToRestore: boolean;
  reverseEdge?: NonNullable<ReturnType<typeof getReplicationEdge>>;
};

async function prepareReverseReplication(
  current: RuntimeNode,
  target: RuntimeNode,
  forwardEdge: NonNullable<ReturnType<typeof getReplicationEdge>>,
): Promise<ReplicationFlipResult> {
  const reverseEdge = getReplicationEdge(target.backend, current.backend);
  if (
    !reverseEdge ||
    !current.canManageSubscription ||
    !target.canManageSubscription
  ) {
    return { ready: false, safeToRestore: true };
  }
  const reverseAlreadyEnabled = await readSubscriptionEnabled(
    current,
    reverseEdge.subscriptionName,
  );
  if (reverseAlreadyEnabled !== false) {
    return { ready: false, safeToRestore: false };
  }

  let reverseCreated = false;
  try {
    reverseCreated = await createFreshSubscription(
      target,
      current,
      reverseEdge.publicationName,
      reverseEdge.subscriptionName,
    );
    if (!reverseCreated) return { ready: false, safeToRestore: true };

    const reverseCaughtUp = await waitForReplicationCatchup(target, current);
    const sequencesSynchronized =
      reverseCaughtUp && (await synchronizeSequences(target, current));
    if (!sequencesSynchronized) {
      const removed = await removeSubscription(
        current,
        reverseEdge.subscriptionName,
      );
      return { ready: false, safeToRestore: removed };
    }

    await target.subscriptionPool.query(
      `ALTER SUBSCRIPTION ${quoteIdentifier(forwardEdge.subscriptionName)} DISABLE`,
    );
    return { ready: true, safeToRestore: true, reverseEdge };
  } catch {
    let safeToRestore = true;
    if (reverseCreated) {
      const removed = await removeSubscription(
        current,
        reverseEdge.subscriptionName,
      );
      if (!removed) {
        safeToRestore = false;
        console.error(
          `[db-failover] Could not remove the new reverse subscription ${reverseEdge.subscriptionName}; writes remain paused.`,
        );
      }
    }
    try {
      await target.subscriptionPool.query(
        `ALTER SUBSCRIPTION ${quoteIdentifier(forwardEdge.subscriptionName)} ENABLE`,
      );
    } catch {
      safeToRestore = false;
    }
    return { ready: false, safeToRestore };
  }
}

async function restoreReplicationDirection(
  current: RuntimeNode,
  target: RuntimeNode,
  forwardEdge: NonNullable<ReturnType<typeof getReplicationEdge>>,
  reverseEdge: NonNullable<ReturnType<typeof getReplicationEdge>>,
): Promise<boolean> {
  const removed = await removeSubscription(
    current,
    reverseEdge.subscriptionName,
  );
  if (!removed) return false;
  try {
    await target.subscriptionPool.query(
      `ALTER SUBSCRIPTION ${quoteIdentifier(forwardEdge.subscriptionName)} ENABLE`,
    );
    return true;
  } catch {
    return false;
  }
}

async function performFailover(
  reason: FailoverReason,
  expectedCurrentBackend?: DatabaseBackend,
  requestedTargetBackend?: DatabaseBackend,
): Promise<boolean> {
  if (!failoverEnabled) return false;

  const statePool = failoverStatePool();
  if (!statePool) return false;
  const currentState = await readBackendState();
  if (currentState === "switching") return false;

  const currentIndex = getBackendIndex(currentState, nodes);
  if (currentIndex < 0) return false;
  const current = nodes[currentIndex];
  if (expectedCurrentBackend && current.backend !== expectedCurrentBackend) {
    return false;
  }
  const target = requestedTargetBackend
    ? nodeForBackend(requestedTargetBackend)
    : getNextBackend(current.backend, nodes);
  if (!target) {
    console.warn(
      `[db-failover] Requested target is not configured from ${current.backend}; kept it active.`,
    );
    return false;
  }
  const targetNode = nodeForBackend(target.backend);
  if (!targetNode) return false;
  if (
    reason === "manual" &&
    !areAdjacentBackends(current.backend, targetNode.backend, nodes)
  ) {
    return false;
  }
  if (!current.canManageSubscription || !targetNode.canManageSubscription) {
    console.warn(
      `[db-failover] Switch from ${current.backend} to ${targetNode.backend} is blocked because both databases need direct replication-management connections.`,
    );
    return false;
  }
  if (!(await supportsCascadingReplication())) {
    console.warn(
      "[db-failover] Multi-database switching is blocked unless every configured Neon database supports cascading logical replication.",
    );
    return false;
  }
  if (!(await stateConstraintAllows(target.backend))) {
    console.warn(
      `[db-failover] Failover to ${target.backend} is blocked until the failover-state migration is applied.`,
    );
    return false;
  }
  const edge = getReplicationEdge(current.backend, targetNode.backend);
  if (!edge) {
    console.warn(
      `[db-failover] Switch from ${current.backend} to ${targetNode.backend} is blocked because the replication direction is not configured.`,
    );
    return false;
  }
  if (!(await waitForReplicationCatchup(current, targetNode))) {
    console.warn(
      `[db-failover] Kept ${current.backend} active because ${target.backend} is not fully synchronized.`,
    );
    return false;
  }
  if (!(await nodeHasCapacity(targetNode))) {
    console.warn(
      `[db-failover] Kept ${current.backend} active because ${target.backend} has no verified storage and CU capacity.`,
    );
    return false;
  }

  const claim = await statePool.query(
    `UPDATE public.db_failover_state
     SET active_backend = 'switching',
         reason = $1,
         updated_at = now()
     WHERE id = 1 AND active_backend = $2
     RETURNING id`,
    [failoverReasonMessage(reason, current.backend), current.backend],
  );
  if (claim.rowCount !== 1) {
    const latest = await readBackendState();
    if (latest !== "switching") setActiveBackend(latest);
    return latest === target.backend;
  }
  setActiveBackend("switching");

  const drained = await waitForTransactionsToDrain(current);
  const caughtUpAgain =
    drained && (await waitForReplicationCatchup(current, targetNode));
  const targetStillHealthy =
    caughtUpAgain && (await nodeHasCapacity(targetNode));
  if (!drained || !caughtUpAgain || !targetStillHealthy) {
    await restoreBackendAfterBlockedFailover(
      current.backend,
      "Automatic switch paused: standby lag, capacity, or active requests.",
    );
    return false;
  }

  if (!(await synchronizeSequences(current, targetNode))) {
    await restoreBackendAfterBlockedFailover(
      current.backend,
      "Database switch paused: sequence state could not be synchronized.",
    );
    return false;
  }

  const replicationFlip = await prepareReverseReplication(
    current,
    targetNode,
    edge,
  );
  if (!replicationFlip.ready || !replicationFlip.reverseEdge) {
    if (replicationFlip.safeToRestore) {
      await restoreBackendAfterBlockedFailover(
        current.backend,
        "Database switch paused: reverse replication could not be established and verified.",
      );
    } else {
      setActiveBackend("switching");
      console.error(
        "[db-failover] Reverse replication cleanup failed; writes remain paused to prevent split-brain.",
      );
    }
    return false;
  }

  try {
    const activated = await statePool.query(
      `UPDATE public.db_failover_state
       SET active_backend = $1,
           reason = $2,
           updated_at = now()
       WHERE id = 1 AND active_backend = 'switching'
       RETURNING id`,
      [target.backend, failoverReasonMessage(reason, current.backend)],
    );
    if (activated.rowCount !== 1) {
      const restored = await restoreReplicationDirection(
        current,
        targetNode,
        edge,
        replicationFlip.reverseEdge,
      );
      if (restored) {
        await restoreBackendAfterBlockedFailover(
          current.backend,
          "Database switch paused: the active database state changed before commit.",
        );
      } else {
        setActiveBackend("switching");
      }
      return false;
    }
  } catch {
    const restored = await restoreReplicationDirection(
      current,
      targetNode,
      edge,
      replicationFlip.reverseEdge,
    );
    if (restored) {
      await restoreBackendAfterBlockedFailover(
        current.backend,
        "Database switch paused: the active database state could not be committed.",
      ).catch(() => setActiveBackend("switching"));
    } else {
      setActiveBackend("switching");
    }
    return false;
  }

  setActiveBackend(target.backend);
  const oldSubscriptionRemoved = await removeSubscription(
    targetNode,
    edge.subscriptionName,
  );
  if (!oldSubscriptionRemoved) {
    console.warn(
      `[db-failover] ${target.backend} is active, but cleanup of the inactive ${edge.subscriptionName} subscription was deferred.`,
    );
  }
  console.warn(
    `[db-failover] Switched from ${current.backend} to ${target.backend} after synchronization and capacity checks.`,
  );
  return true;
}

async function requestFailover(
  reason: FailoverReason,
  expectedCurrentBackend?: DatabaseBackend,
  requestedTargetBackend?: DatabaseBackend,
): Promise<boolean> {
  if (failoverPromise) return failoverPromise;
  failoverPromise = performFailover(
    reason,
    expectedCurrentBackend,
    requestedTargetBackend,
  ).finally(() => {
    failoverPromise = null;
  });
  return failoverPromise;
}

const AVAILABILITY_FAILOVER_COOLDOWN_MS = 15_000;

async function requestAvailabilityFailover(): Promise<boolean> {
  if (failoverPromise) return failoverPromise;
  if (Date.now() - lastAvailabilityFailoverAttemptAt < AVAILABILITY_FAILOVER_COOLDOWN_MS) {
    return false;
  }
  lastAvailabilityFailoverAttemptAt = Date.now();
  const switched = await requestFailover("availability").catch(() => false);
  if (switched) lastAvailabilityFailoverAttemptAt = 0;
  return switched;
}

async function checkCurrentCapacity(): Promise<void> {
  if (!failoverEnabled) return;
  const current = activeNode();
  if (!current) return;

  if (capacityCheckPromise) {
    await capacityCheckPromise;
    return;
  }

  const now = Date.now();
  if (
    lastCapacityCheckBackend === current.backend &&
    now - lastCapacityCheckAt < 30_000
  ) {
    return;
  }

  const checkPromise = (async () => {
    let usedBytes: string | undefined;
    try {
      const result = await current.pool.query(
        "SELECT pg_database_size(current_database())::text AS bytes",
      );
      usedBytes = result.rows[0]?.bytes as string | undefined;
    } catch (error) {
      if (isDatabaseCapacityError(error)) {
        const switched = await requestFailover("storage").catch(() => false);
        if (!switched) {
          throw new Error(
            `The active database ${current.backend} is full and no synchronized standby with verified capacity is available.`,
          );
        }
        return;
      }
      if (!isDatabaseAvailabilityError(error)) throw error;
      const switched = await requestAvailabilityFailover();
      if (!switched) {
        throw new Error(
          `The active database ${current.backend} is unavailable; no adjacent standby could be safely activated.`,
        );
      }
      return;
    }

    if (!usedBytes) {
      throw new Error(
        `Storage usage could not be verified for ${current.backend}.`,
      );
    }
    if (hasReachedDatabaseCapacity(usedBytes, current.maxBytes)) {
      const switched = await requestFailover("storage");
      if (!switched) {
        throw new Error(
          `The active database ${current.backend} reached its storage threshold and failover was blocked.`,
        );
      }
      return;
    }

    if (!neonApiKey || !current.projectId) {
      throw new Error(
        `Neon CU-hour monitoring is not configured for ${current.backend}.`,
      );
    }
    let usedComputeSeconds: number;
    try {
      usedComputeSeconds = await readComputeUsageSeconds(current);
    } catch (error) {
      console.warn(
        `[db-failover] Neon CU usage could not be verified for ${current.backend}; API requests will fail closed.`,
      );
      throw error;
    }
    if (
      !hasReachedComputeTimeLimit(
        usedComputeSeconds,
        DATABASE_COMPUTE_LIMIT_SECONDS,
      )
    ) {
      return;
    }
    const switched = await requestFailover("compute");
    if (!switched) {
      throw new Error(
        `The active database ${current.backend} reached 100 CU-hours and failover was blocked.`,
      );
    }
  })();

  capacityCheckPromise = checkPromise;
  try {
    await checkPromise;
    lastCapacityCheckAt = Date.now();
    lastCapacityCheckBackend = current.backend;
  } catch (error) {
    lastCapacityCheckAt = 0;
    lastCapacityCheckBackend = null;
    throw error;
  } finally {
    if (capacityCheckPromise === checkPromise) capacityCheckPromise = null;
  }
}

export async function refreshDatabaseBackend(): Promise<PersistedDatabaseBackend> {
  if (!failoverEnabled) return "database_url";
  const backend = await readBackendState();
  setActiveBackend(backend);
  if (backend === "switching") return backend;
  await checkCurrentCapacity();
  return activeBackend;
}

const allDatabaseBackends: readonly DatabaseBackend[] = [
  "database_url_1",
  "database_url",
  "database_url_3",
  "database_url_4",
];

async function getSwitchTargetStatus(
  active: PersistedDatabaseBackend,
  targetBackend: DatabaseBackend,
): Promise<{
  backend: DatabaseBackend;
  configured: boolean;
  active: boolean;
  canSwitch: boolean;
  message: string;
}> {
  const target = nodeForBackend(targetBackend);
  const isActive = active === targetBackend;
  const base = {
    backend: targetBackend,
    configured: Boolean(target),
    active: isActive,
  };
  if (!target) {
    return { ...base, canSwitch: false, message: "Chưa cấu hình kho này." };
  }
  if (isActive) {
    return { ...base, canSwitch: false, message: "Đang hoạt động." };
  }
  if (!isVercel || process.env.VERCEL_ENV !== "production") {
    return {
      ...base,
      canSwitch: false,
      message: "Chỉ chuyển kho trên bản production Vercel.",
    };
  }
  if (!failoverEnabled) {
    return {
      ...base,
      canSwitch: false,
      message: "Chưa bật failover: cần cấu hình DATABASE_URL_1 và DATABASE_URL.",
    };
  }
  if (active === "switching") {
    return {
      ...base,
      canSwitch: false,
      message: "Đang có thao tác chuyển kho.",
    };
  }
  const current = nodeForBackend(active);
  if (!current || !areAdjacentBackends(current.backend, target.backend, nodes)) {
    return {
      ...base,
      canSwitch: false,
      message: "Chỉ chuyển trực tiếp sang kho liền kề.",
    };
  }
  if (!(await supportsCascadingReplication())) {
    return {
      ...base,
      canSwitch: false,
      message: "Cần PostgreSQL 16+ trên mọi kho để đồng bộ theo chuỗi.",
    };
  }
  if (!current.canManageSubscription || !target.canManageSubscription) {
    return {
      ...base,
      canSwitch: false,
      message: "Cần kết nối trực tiếp để quản lý replication.",
    };
  }
  if (!neonApiKey) {
    return {
      ...base,
      canSwitch: false,
      message: "Thiếu NEON_API_KEY để kiểm tra giới hạn CU.",
    };
  }
  if (!target.projectId) {
    return {
      ...base,
      canSwitch: false,
      message: "Thiếu mã project Neon để kiểm tra giới hạn CU.",
    };
  }
  if (!(await stateConstraintAllows(target.backend))) {
    return {
      ...base,
      canSwitch: false,
      message: "Cần cập nhật bảng trạng thái failover trên database.",
    };
  }
  const edge = getReplicationEdge(current.backend, target.backend);
  const replicationReadiness = edge
    ? await getReplicationReadiness(current, target)
    : {
        ready: false,
        message: describeReplicationBlocker({ kind: "edge_missing" }),
      };
  if (!replicationReadiness.ready) {
    return {
      ...base,
      canSwitch: false,
      message: replicationReadiness.message,
    };
  }
  const reverseEdge = getReplicationEdge(target.backend, current.backend);
  if (
    !reverseEdge ||
    (await readSubscriptionEnabled(current, reverseEdge.subscriptionName)) !==
      false
  ) {
    return {
      ...base,
      canSwitch: false,
      message: "Không xác minh được chiều replication ngược; chuyển bị khóa.",
    };
  }
  if (!(await nodeHasCapacity(target))) {
    return {
      ...base,
      canSwitch: false,
      message: "Chưa xác nhận được dung lượng và CU còn trống.",
    };
  }
  return {
    ...base,
    canSwitch: true,
    message: "Đã đồng bộ; có thể chuyển an toàn.",
  };
}

export async function getDatabaseFailoverStatus(): Promise<{
  activeBackend: PersistedDatabaseBackend;
  switchTargets: Awaited<ReturnType<typeof getSwitchTargetStatus>>[];
}> {
  const activeBackend = await refreshDatabaseBackend();
  return {
    activeBackend,
    switchTargets: await Promise.all(
      allDatabaseBackends.map((backend) =>
        getSwitchTargetStatus(activeBackend, backend),
      ),
    ),
  };
}

export async function requestOwnerDatabaseFailover(
  fromBackend: DatabaseBackend,
  targetBackend: DatabaseBackend,
): Promise<{
  switched: boolean;
  activeBackend: PersistedDatabaseBackend;
}> {
  if (!isVercel || process.env.VERCEL_ENV !== "production" || !failoverEnabled) {
    return { switched: false, activeBackend: await readBackendState() };
  }

  const currentBackend = await readBackendState();
  if (
    currentBackend !== fromBackend ||
    !nodeForBackend(targetBackend) ||
    !areAdjacentBackends(fromBackend, targetBackend, nodes)
  ) {
    return { switched: false, activeBackend: currentBackend };
  }

  await requestFailover("manual", fromBackend, targetBackend);
  const activeBackend = await readBackendState();
  return {
    switched: activeBackend === targetBackend,
    activeBackend,
  };
}

export class DatabaseFailoverInProgressError extends Error {
  constructor() {
    super("Database failover is in progress.");
    this.name = "DatabaseFailoverInProgressError";
  }
}

function installCapacityErrorHandling(node: RuntimeNode): void {
  const pool = node.pool;
  const rawPoolQuery = pool.query.bind(pool) as (
    ...args: any[]
  ) => any;
  const handleResult = (result: any, isCapacityProbe: boolean): any => {
    if (!isPromiseLike(result)) return result;
    return result.catch(async (error: unknown) => {
      if (
        isDatabaseFailoverTriggerError(error) &&
        activeBackend === node.backend &&
        !failoverPromise &&
        !isCapacityProbe
      ) {
        if (isDatabaseCapacityError(error)) {
          await requestFailover("storage").catch(() => false);
        } else {
          // Do not replay the failed query: a lost response can mean COMMIT succeeded.
          await requestAvailabilityFailover();
        }
      }
      throw error;
    });
  };
  const monitoredPool = pool as unknown as Queryable;
  monitoredPool.query = (...args: any[]) =>
    handleResult(
      rawPoolQuery(...args),
      /pg_database_size\s*\(/i.test(queryText(args)),
    );

  const rawConnect = pool.connect.bind(pool) as (...args: any[]) => any;
  const monitoredConnect = (...args: any[]) => {
    const callback = args[0];
    if (typeof callback === "function") {
      return rawConnect(
        (error: unknown, client: pg.PoolClient, release: () => void) => {
          if (client) installClientHandler(client, node);
          callback(error, client, release);
        },
      );
    }
    return rawConnect().then((client: pg.PoolClient) => {
      installClientHandler(client, node);
      return client;
    });
  };
  (pool as unknown as { connect: (...args: any[]) => any }).connect =
    monitoredConnect;
}

const monitoredClients = new WeakSet<object>();

function installClientHandler(client: pg.PoolClient, node: RuntimeNode): void {
  if (monitoredClients.has(client)) return;
  monitoredClients.add(client);
  let inTransaction = false;
  const rawQuery = client.query.bind(client) as (
    ...args: any[]
  ) => any;

  (client as unknown as Queryable).query = (...args: any[]) => {
    const text = queryText(args);
    const result = rawQuery(...args);
    if (!isPromiseLike(result)) return result;
    return result
      .then((value) => {
        if (/^\s*(begin|start\s+transaction)\b/i.test(text)) {
          inTransaction = true;
        } else if (/^\s*(commit|end|rollback)\b/i.test(text)) {
          inTransaction = false;
        }
        return value;
      })
      .catch(async (error: unknown) => {
        if (
          isDatabaseFailoverTriggerError(error) &&
          activeBackend === node.backend &&
          !failoverPromise
        ) {
          if (inTransaction && (isDatabaseCapacityError(error) || isDatabaseAvailabilityError(error))) {
            await rawQuery("ROLLBACK").catch(() => undefined);
            inTransaction = false;
          }
          if (isDatabaseCapacityError(error)) {
            await requestFailover("storage").catch(() => false);
          } else {
            // Future requests may use the promoted node; this failed statement is never retried.
            await requestAvailabilityFailover();
          }
        }
        throw error;
      });
  };
}

for (const node of nodes) {
  if (failoverEnabled) installCapacityErrorHandling(node);
}

const databaseUrlPool = nodeForBackend("database_url")?.pool ?? nodes[0]?.pool;
if (!databaseUrlPool) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = databaseUrlPool;
export const db = new Proxy(nodes[0]?.database, {
  get(_target, property) {
    if (activeBackend === "switching") {
      throw new DatabaseFailoverInProgressError();
    }
    if (!activeDatabase) {
      throw new Error("The active database connection is not configured.");
    }
    const value = Reflect.get(activeDatabase, property, activeDatabase) as unknown;
    return typeof value === "function" ? value.bind(activeDatabase) : value;
  },
}) as NonNullable<typeof activeDatabase>;
