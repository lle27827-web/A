import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  DATABASE_COMPUTE_LIMIT_SECONDS,
  DATABASE_STORAGE_LIMIT_BYTES,
  hasReachedDatabaseCapacity,
  hasReachedComputeTimeLimit,
  isDatabaseCapacityError,
  parseNeonComputeTimeSeconds,
  parseDatabaseCapacityLimit,
} from "./failover-utils";

type Backend = "database_url_1" | "database_url" | "switching";
type Queryable = { query: (...args: any[]) => any };

const sourceUrl = process.env.DATABASE_URL?.trim();
const databaseUrl1 = process.env.DATABASE_URL_1?.trim();
const isVercel = process.env.VERCEL === "1";
const failoverEnabled = isVercel && Boolean(sourceUrl && databaseUrl1);

if (!sourceUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

if (isVercel && databaseUrl1 && !sourceUrl) {
  throw new Error(
    "DATABASE_URL must remain set as the fallback for DATABASE_URL_1.",
  );
}

const capacityLimitBytes =
  parseDatabaseCapacityLimit(process.env.DATABASE_URL_1_MAX_BYTES) ??
  DATABASE_STORAGE_LIMIT_BYTES;
const neonApiKey = process.env.NEON_API_KEY?.trim();
const neonProjectId = process.env.NEON_PROJECT_ID_1?.trim();

if (failoverEnabled && (!neonApiKey || !neonProjectId)) {
  console.warn(
    "[db-failover] Neon CU-hour monitoring is disabled until NEON_API_KEY and NEON_PROJECT_ID_1 are configured.",
  );
}
const sourcePool = new pg.Pool({
  connectionString: sourceUrl,
  application_name: "so-cong-db-fallback",
});
const databaseUrl1Pool = failoverEnabled
  ? new pg.Pool({
      connectionString: databaseUrl1,
      application_name: "so-cong-db-primary",
    })
  : sourcePool;
const sourceDatabase = drizzle(sourcePool, { schema });
const databaseUrl1Database = failoverEnabled
  ? drizzle(databaseUrl1Pool, { schema })
  : sourceDatabase;

let activeBackend: Backend = failoverEnabled
  ? "database_url_1"
  : "database_url";
let activeDatabase = failoverEnabled
  ? databaseUrl1Database
  : sourceDatabase;
let lastCapacityCheckAt = 0;
let capacityCheckPromise: Promise<void> | null = null;
let failoverPromise: Promise<boolean> | null = null;

const sourceQuery = sourcePool.query.bind(sourcePool) as (
  ...args: any[]
) => Promise<any>;
const databaseUrl1Query = databaseUrl1Pool.query.bind(
  databaseUrl1Pool,
) as (...args: any[]) => Promise<any>;

const lsnPollIntervalMs = 250;
const lsnPollAttempts = 12;
const transactionDrainAttempts = 12;

function setActiveBackend(backend: Backend): void {
  activeBackend = backend;
  if (backend === "database_url") activeDatabase = sourceDatabase;
  if (backend === "database_url_1") activeDatabase = databaseUrl1Database;
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
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

async function readBackendState(): Promise<Backend> {
  if (!failoverEnabled) return "database_url";

  const result = await sourceQuery(
    "SELECT active_backend FROM public.db_failover_state WHERE id = 1",
  );
  const backend = result.rows[0]?.active_backend as Backend | undefined;
  if (
    backend !== "database_url_1" &&
    backend !== "database_url" &&
    backend !== "switching"
  ) {
    throw new Error(
      "Database failover state is missing or has an unsupported value.",
    );
  }
  return backend;
}

async function standbyIsCaughtUp(): Promise<boolean> {
  if (!failoverEnabled) return false;

  const [subscription, subscriptionTables, publishedTables, publicTables] =
    await Promise.all([
      sourceQuery(
        `SELECT subenabled
         FROM pg_subscription
         WHERE subname = 'socong_source_from_db1_v1'`,
      ),
      sourceQuery(
        `SELECT count(*)::int AS count,
                coalesce(bool_and(srsubstate = 'r'), false) AS all_ready
         FROM pg_subscription_rel r
         JOIN pg_subscription s ON s.oid = r.srsubid
         WHERE s.subname = 'socong_source_from_db1_v1'`,
      ),
      databaseUrl1Query(
        `SELECT count(*)::int AS count
         FROM pg_publication_tables
         WHERE pubname = 'socong_db1_to_source_v1'`,
      ),
      databaseUrl1Query(
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
    publishedTables.rows[0]?.count !== publicTables.rows[0]?.count
  ) {
    return false;
  }

  const lastEnd = await sourceQuery(
    `SELECT latest_end_lsn::text AS lsn
     FROM pg_stat_subscription
     WHERE subname = 'socong_source_from_db1_v1'
       AND worker_type = 'apply'
     LIMIT 1`,
  );
  const appliedLsn = lastEnd.rows[0]?.lsn as string | undefined;
  if (!appliedLsn) return false;

  const current = await databaseUrl1Query(
    "SELECT pg_current_wal_lsn()::text AS lsn",
  );
  const currentLsn = current.rows[0]?.lsn as string | undefined;
  if (!currentLsn) return false;

  const difference = await sourceQuery(
    "SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn) <= 0 AS caught_up",
    [currentLsn, appliedLsn],
  );
  return difference.rows[0]?.caught_up === true;
}

async function waitForStandbyToCatchUp(): Promise<boolean> {
  for (let attempt = 0; attempt < lsnPollAttempts; attempt += 1) {
    try {
      if (await standbyIsCaughtUp()) return true;
    } catch {
      return false;
    }
    await delay(lsnPollIntervalMs);
  }
  return false;
}

async function waitForPrimaryTransactionsToDrain(): Promise<boolean> {
  let idleChecks = 0;
  for (
    let attempt = 0;
    attempt < transactionDrainAttempts;
    attempt += 1
  ) {
    try {
      const result = await databaseUrl1Query(
        `SELECT count(*)::int AS active
         FROM pg_stat_activity
         WHERE pid <> pg_backend_pid()
           AND datname = current_database()
           AND backend_type = 'client backend'
           AND application_name = 'so-cong-db-primary'
           AND xact_start IS NOT NULL`,
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

async function restorePrimaryAfterBlockedFailover(
  reason: string,
): Promise<void> {
  await sourceQuery(
    `UPDATE public.db_failover_state
     SET active_backend = 'database_url_1',
         reason = $1,
         updated_at = now()
     WHERE id = 1 AND active_backend = 'switching'`,
    [reason],
  );
  setActiveBackend("database_url_1");
}

async function performFailover(reason: string): Promise<boolean> {
  if (!failoverEnabled) return false;

  const current = await readBackendState();
  if (current === "database_url") {
    setActiveBackend("database_url");
    return true;
  }
  if (current !== "database_url_1") return false;

  if (!(await waitForStandbyToCatchUp())) {
    console.warn(
      "[db-failover] Kept DATABASE_URL_1 active because DATABASE_URL is not fully synchronized.",
    );
    return false;
  }

  const claim = await sourceQuery(
    `UPDATE public.db_failover_state
     SET active_backend = 'switching',
         reason = $1,
         updated_at = now()
     WHERE id = 1 AND active_backend = 'database_url_1'
     RETURNING id`,
    [reason],
  );

  if (claim.rowCount !== 1) {
    const latest = await readBackendState();
    if (latest === "database_url") setActiveBackend("database_url");
    return latest === "database_url";
  }
  setActiveBackend("switching");

  const drained = await waitForPrimaryTransactionsToDrain();
  const caughtUpAgain = drained && (await waitForStandbyToCatchUp());
  if (!drained || !caughtUpAgain) {
    await restorePrimaryAfterBlockedFailover(
      "Automatic switch paused: standby lag or active requests.",
    );
    return false;
  }

  try {
    await sourceQuery(
      "ALTER SUBSCRIPTION socong_source_from_db1_v1 DISABLE",
    );
  } catch {
    await restorePrimaryAfterBlockedFailover(
      "Automatic switch paused: could not stop replication safely.",
    ).catch(() => setActiveBackend("switching"));
    return false;
  }

  const activated = await sourceQuery(
    `UPDATE public.db_failover_state
     SET active_backend = 'database_url',
         reason = $1,
         updated_at = now()
     WHERE id = 1 AND active_backend = 'switching'
     RETURNING id`,
    [reason],
  );
  if (activated.rowCount !== 1) {
    setActiveBackend("switching");
    return false;
  }

  setActiveBackend("database_url");
  console.warn(
    "[db-failover] Switched to DATABASE_URL after the synchronized standby passed the safety checks.",
  );
  return true;
}

async function requestFailover(reason: string): Promise<boolean> {
  if (failoverPromise) return failoverPromise;
  failoverPromise = performFailover(reason).finally(() => {
    failoverPromise = null;
  });
  return failoverPromise;
}

async function checkCapacityThreshold(): Promise<void> {
  if (!failoverEnabled) return;

  const now = Date.now();
  if (now - lastCapacityCheckAt < 30_000) {
    if (capacityCheckPromise) await capacityCheckPromise;
    return;
  }
  lastCapacityCheckAt = now;
  capacityCheckPromise = (async () => {
    let usedBytes: string | undefined;
    try {
      const result = await databaseUrl1Query(
        "SELECT pg_database_size(current_database())::text AS bytes",
      );
      usedBytes = result.rows[0]?.bytes as string | undefined;
    } catch (error) {
      if (!isDatabaseCapacityError(error)) throw error;
      const switched = await requestFailover(
        "DATABASE_URL_1 returned a storage-capacity error during its capacity check.",
      ).catch(() => false);
      if (!switched) {
        throw new Error(
          "DATABASE_URL_1 returned a storage-capacity error, but automatic failover was blocked because the fallback database is not fully synchronized.",
        );
      }
      return;
    }

    if (usedBytes && hasReachedDatabaseCapacity(usedBytes, capacityLimitBytes)) {
      const switched = await requestFailover(
        "DATABASE_URL_1 reached its configured storage threshold.",
      );
      if (!switched) {
        throw new Error(
          "DATABASE_URL_1 reached its storage threshold, but automatic failover was blocked because the fallback database is not fully synchronized.",
        );
      }
      return;
    }

    if (!neonApiKey || !neonProjectId) return;

    let usedComputeSeconds: number;
    try {
      const response = await fetch(
        `https://console.neon.tech/api/v2/projects/${encodeURIComponent(neonProjectId)}`,
        {
          headers: { Authorization: `Bearer ${neonApiKey}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) {
        throw new Error(`Neon usage API returned HTTP ${response.status}.`);
      }
      usedComputeSeconds = parseNeonComputeTimeSeconds(await response.json());
    } catch {
      console.warn(
        "[db-failover] Neon compute usage could not be checked; continuing with the active database.",
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

    const switched = await requestFailover(
      "DATABASE_URL_1 reached the 100 CU-hour compute threshold.",
    );
    if (!switched) {
      throw new Error(
        "DATABASE_URL_1 reached the compute threshold, but automatic failover was blocked because the fallback database is not fully synchronized.",
      );
    }
  })();

  try {
    await capacityCheckPromise;
  } finally {
    capacityCheckPromise = null;
  }
}

export async function refreshDatabaseBackend(): Promise<Backend> {
  if (!failoverEnabled) return "database_url";

  const backend = await readBackendState();
  setActiveBackend(backend);
  if (backend === "switching") return backend;
  if (backend === "database_url_1") await checkCapacityThreshold();
  return activeBackend;
}

export class DatabaseFailoverInProgressError extends Error {
  constructor() {
    super("Database failover is in progress.");
    this.name = "DatabaseFailoverInProgressError";
  }
}

function installCapacityErrorHandling(pool: pg.Pool): void {
  const rawPoolQuery = pool.query.bind(pool) as (
    ...args: any[]
  ) => any;
  const handleResult = (result: any): any => {
    if (!isPromiseLike(result)) return result;
    return result.catch(async (error: unknown) => {
      if (isDatabaseCapacityError(error)) {
        await requestFailover("DATABASE_URL_1 returned a storage-capacity error.").catch(
          () => false,
        );
      }
      throw error;
    });
  };
  const monitoredPool = pool as unknown as Queryable;
  monitoredPool.query = (...args: any[]) => handleResult(rawPoolQuery(...args));

  const rawConnect = pool.connect.bind(pool) as (...args: any[]) => any;
  const monitoredConnect = (...args: any[]) => {
    const callback = args[0];
    if (typeof callback === "function") {
      return rawConnect((error: unknown, client: pg.PoolClient, release: () => void) => {
        if (client) installClientHandler(client);
        callback(error, client, release);
      });
    }
    return rawConnect().then((client: pg.PoolClient) => {
      installClientHandler(client);
      return client;
    });
  };
  (pool as unknown as { connect: (...args: any[]) => any }).connect =
    monitoredConnect;
}

const monitoredClients = new WeakSet<object>();

function installClientHandler(client: pg.PoolClient): void {
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
        if (isDatabaseCapacityError(error)) {
          if (inTransaction) {
            await rawQuery("ROLLBACK").catch(() => undefined);
            inTransaction = false;
          }
          await requestFailover(
            "DATABASE_URL_1 returned a storage-capacity error.",
          ).catch(() => false);
        }
        throw error;
      });
  };
}

if (failoverEnabled) installCapacityErrorHandling(databaseUrl1Pool);

export const pool = sourcePool;
export const db = new Proxy(sourceDatabase, {
  get(_target, property) {
    if (activeBackend === "switching") {
      throw new DatabaseFailoverInProgressError();
    }
    const selected = activeDatabase as typeof sourceDatabase;
    const value = Reflect.get(selected, property, selected) as unknown;
    return typeof value === "function" ? value.bind(selected) : value;
  },
}) as typeof sourceDatabase;
