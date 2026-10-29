import { AsyncLocalStorage } from "node:async_hooks";

type QueryableClient = {
  query(query: string, values?: unknown[]): Promise<unknown>;
  release?(error?: Error | boolean): void;
};

type LockContext = {
  client: QueryableClient;
  heldLocks: Set<string>;
};

const lockContext = new AsyncLocalStorage<LockContext>();

export class AdvisoryLockReleaseError extends Error {
  constructor(
    public readonly operationError: unknown,
    public readonly unlockError: unknown,
  ) {
    super("Could not release a PostgreSQL advisory lock.");
    this.name = "AdvisoryLockReleaseError";
  }
}

export async function withReentrantAdvisoryLock<T>(
  client: QueryableClient,
  lockName: string,
  callback: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  const current = lockContext.getStore();
  if (current && current.client !== client) {
    throw new Error("Nested coordinator locks must use the same database connection.");
  }
  if (current?.heldLocks.has(lockName)) return callback();

  const acquire = async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const result = await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
        [`so-cong:partition-write:${lockName}`],
      ) as { rows?: Array<{ locked?: boolean }> };
      if (result.rows?.[0]?.locked === true) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for partition advisory lock "${lockName}".`);
  };
  const release = () => client.query(
    "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
    [`so-cong:partition-write:${lockName}`],
  );
  const hold = async (context: LockContext) => {
    await acquire();
    context.heldLocks.add(lockName);
    let result: T | undefined;
    let operationError: unknown;
    let hasOperationError = false;
    let unlockError: unknown;
    try {
      result = await callback();
    } catch (error) {
      operationError = error;
      hasOperationError = true;
    } finally {
      context.heldLocks.delete(lockName);
      try {
        await release();
      } catch (error) {
        unlockError = error;
      }
    }
    if (unlockError !== undefined) throw new AdvisoryLockReleaseError(operationError, unlockError);
    if (hasOperationError) throw operationError;
    return result as T;
  };

  if (current) return hold(current);
  return lockContext.run({ client, heldLocks: new Set<string>() }, () => hold(lockContext.getStore()!));
}
