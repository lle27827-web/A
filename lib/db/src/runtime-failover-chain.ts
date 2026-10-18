import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  DATABASE_COMPUTE_LIMIT_SECONDS,
  DATABASE_STORAGE_LIMIT_BYTES,
  hasReachedComputeTimeLimit,
  hasReachedDatabaseCapacity,
  isDatabaseCapacityError,
  parseDatabaseCapacityLimit,
  parseNeonComputeTimeSeconds,
} from "./failover-utils";
import {
  failoverStateConstraintSupports,
  getBackendIndex,
  getNextBackend,
  getReplicationEdge,
  isPersistedDatabaseBackend,
  resolveDatabaseNodes,
  type DatabaseBackend,
  type DatabaseNodeConfig,
  type PersistedDatabaseBackend,
} from "./failover-topology";

type Queryable = { query: (...args: any[]) => any };
type RuntimeNode = Omit<DatabaseNodeConfig, "maxBytes"> & {
  pool: pg.Pool;
  database: ReturnType<typeof drizzle<typeof schema>>;
  maxBytes: bigint;
};
type FailoverReason = "compute" | "storage";

const isVercel = process.env.VERCEL === "1";
const configuredNodes = resolveDatabaseNodes(process.env);
const databaseUrl = process.env.DATABASE_URL?.trim();
const failoverEnabled =
  isVercel &&
  Boolean(process.env.DATABASE_URL_1?.trim() && databaseUrl) &&
  configuredNodes.length >= 2;
const stateBackend: DatabaseBackend = "database_url";
const neonApiKey = process.env.NEON_API_KEY?.trim();

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
  return {
    ...node,
    pool,
    database: drizzle(pool, { schema }),
    maxBytes,
  };
});

if (failoverEnabled) {
  for (const node of nodes.slice(1)) {
    if (!node.projectId) {
      console.warn(
        `[db-failover] ${node.backend} is configured without its Neon project ID; it cannot be promoted automatically.`,
      );
    }
  }
  if (!neonApiKey) {
    console.warn(
      "[db-failover] Neon CU-hour monitoring is disabled until NEON_API_KEY is configured.",
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

const lsnPollIntervalMs = 250;
const lsnPollAttempts = 12;
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

  const statePool = controlNode()?.pool;
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
  const statePool = controlNode()?.pool;
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

async function replicationIsCaughtUp(
  publisher: RuntimeNode,
  subscriber: RuntimeNode,
): Promise<boolean> {
  const edge = getReplicationEdge(publisher.backend, subscriber.backend);
  if (!edge) return false;

  try {
    const [
      subscription,
      subscriptionTables,
      publishedTables,
      publisherTables,
    ] = await Promise.all([
      subscriber.pool.query(
        `SELECT subenabled
         FROM pg_subscription
         WHERE subname = $1`,
        [edge.subscriptionName],
      ),
      subscriber.pool.query(
        `SELECT count(*)::int AS count,
                coalesce(bool_and(srsubstate = 'r'), false) AS all_ready
         FROM pg_subscription_rel r
         JOIN pg_subscription s ON s.oid = r.srsubid
         WHERE s.subname = $1`,
        [edge.subscriptionName],
      ),
      publisher.pool.query(
        `SELECT count(*)::int AS count
         FROM pg_publication_tables
         WHERE pubname = $1`,
        [edge.publicationName],
      ),
      publisher.pool.query(
        `SELECT count(*)::int AS count
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind IN ('r', 'p')`,
      ),
    ]);

    if (
      !subscription.rows[0]?.subenabled ||
      subscriptionTables.rows[0]?.count < 1 ||
      !subscriptionTables.rows[0]?.all_ready ||
      subscriptionTables.rows[0]?.count !== publishedTables.rows[0]?.count ||
      publishedTables.rows[0]?.count !== publisherTables.rows[0]?.count
    ) {
      return false;
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
    if (!appliedLsn || !currentLsn) return false;

    const difference = await subscriber.pool.query(
      "SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn) <= 0 AS caught_up",
      [currentLsn, appliedLsn],
    );
    return difference.rows[0]?.caught_up === true;
  } catch {
    return false;
  }
}

async function waitForReplicationCatchup(
  publisher: RuntimeNode,
  subscriber: RuntimeNode,
): Promise<boolean> {
  for (let attempt = 0; attempt < lsnPollAttempts; attempt += 1) {
    if (await replicationIsCaughtUp(publisher, subscriber)) return true;
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

async function restoreBackendAfterBlockedFailover(
  backend: DatabaseBackend,
  reason: string,
): Promise<void> {
  const statePool = controlNode()?.pool;
  if (!statePool) throw new Error("The failover state database is unavailable.");
  await statePool.query(
    `UPDATE public.db_failover_state
     SET active_backend = $1,
         reason = $2,
         updated_at = now()
     WHERE id = 1 AND active_backend = 'switching'`,
    [backend, reason],
  );
  setActiveBackend(backend);
}

async function performFailover(reason: FailoverReason): Promise<boolean> {
  if (!failoverEnabled) return false;

  const statePool = controlNode()?.pool;
  if (!statePool) return false;
  const currentState = await readBackendState();
  if (currentState === "switching") return false;

  const currentIndex = getBackendIndex(currentState, nodes);
  if (currentIndex < 0) return false;
  const current = nodes[currentIndex];
  const target = getNextBackend(current.backend, nodes);
  if (!target) {
    console.warn(
      `[db-failover] No standby remains after ${current.backend}; kept it active.`,
    );
    return false;
  }
  const targetNode = nodeForBackend(target.backend);
  if (!targetNode) return false;
  if (!(await stateConstraintAllows(target.backend))) {
    console.warn(
      `[db-failover] Failover to ${target.backend} is blocked until the failover-state migration is applied.`,
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
    [`${reason} limit reached on ${current.backend}.`, current.backend],
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

  const edge = getReplicationEdge(current.backend, targetNode.backend);
  if (!edge) {
    await restoreBackendAfterBlockedFailover(
      current.backend,
      "Automatic switch paused: replication edge is not configured.",
    );
    return false;
  }

  try {
    await targetNode.pool.query(
      `ALTER SUBSCRIPTION ${edge.subscriptionName} DISABLE`,
    );
  } catch {
    await restoreBackendAfterBlockedFailover(
      current.backend,
      "Automatic switch paused: could not stop replication safely.",
    ).catch(() => setActiveBackend("switching"));
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
      [target.backend, `${reason} limit reached on ${current.backend}.`],
    );
    if (activated.rowCount !== 1) {
      setActiveBackend("switching");
      return false;
    }
  } catch {
    setActiveBackend("switching");
    return false;
  }

  setActiveBackend(target.backend);
  console.warn(
    `[db-failover] Switched from ${current.backend} to ${target.backend} after synchronization and capacity checks.`,
  );
  return true;
}

async function requestFailover(reason: FailoverReason): Promise<boolean> {
  if (failoverPromise) return failoverPromise;
  failoverPromise = performFailover(reason).finally(() => {
    failoverPromise = null;
  });
  return failoverPromise;
}

async function checkCurrentCapacity(): Promise<void> {
  if (!failoverEnabled) return;
  const current = activeNode();
  if (!current) return;

  const now = Date.now();
  if (
    lastCapacityCheckBackend === current.backend &&
    now - lastCapacityCheckAt < 30_000
  ) {
    if (capacityCheckPromise) await capacityCheckPromise;
    return;
  }
  lastCapacityCheckAt = now;
  lastCapacityCheckBackend = current.backend;
  capacityCheckPromise = (async () => {
    let usedBytes: string | undefined;
    try {
      const result = await current.pool.query(
        "SELECT pg_database_size(current_database())::text AS bytes",
      );
      usedBytes = result.rows[0]?.bytes as string | undefined;
    } catch (error) {
      if (!isDatabaseCapacityError(error)) throw error;
      const switched = await requestFailover("storage").catch(() => false);
      if (!switched) {
        throw new Error(
          `The active database ${current.backend} is full and no synchronized standby with verified capacity is available.`,
        );
      }
      return;
    }

    if (
      usedBytes &&
      hasReachedDatabaseCapacity(usedBytes, current.maxBytes)
    ) {
      const switched = await requestFailover("storage");
      if (!switched) {
        throw new Error(
          `The active database ${current.backend} reached its storage threshold and failover was blocked.`,
        );
      }
      return;
    }

    if (!neonApiKey || !current.projectId) return;
    let usedComputeSeconds: number;
    try {
      usedComputeSeconds = await readComputeUsageSeconds(current);
    } catch {
      console.warn(
        `[db-failover] Neon CU usage could not be checked for ${current.backend}; continuing with the active database.`,
      );
      return;
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

  try {
    await capacityCheckPromise;
  } finally {
    capacityCheckPromise = null;
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
        isDatabaseCapacityError(error) &&
        activeBackend === node.backend &&
        !failoverPromise &&
        !isCapacityProbe
      ) {
        await requestFailover("storage").catch(() => false);
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
          isDatabaseCapacityError(error) &&
          activeBackend === node.backend &&
          !failoverPromise
        ) {
          if (inTransaction) {
            await rawQuery("ROLLBACK").catch(() => undefined);
            inTransaction = false;
          }
          await requestFailover("storage").catch(() => false);
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
