import { AsyncLocalStorage } from "node:async_hooks";

type QueryableClient = {
  query(query: string, values?: unknown[]): Promise<unknown>;
};

type LockContext = {
  client: QueryableClient;
  heldLocks: Set<string>;
};

const lockContext = new AsyncLocalStorage<LockContext>();

export async function withReentrantAdvisoryLock<T>(
  client: QueryableClient,
  lockName: string,
  callback: () => Promise<T>,
): Promise<T> {
  const current = lockContext.getStore();
  if (current && current.client !== client) {
    throw new Error("Nested coordinator locks must use the same database connection.");
  }
  if (current?.heldLocks.has(lockName)) return callback();

  const acquire = () => client.query(
    "SELECT pg_advisory_lock(hashtextextended($1, 0))",
    [`so-cong:partition-write:${lockName}`],
  );
  const release = () => client.query(
    "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
    [`so-cong:partition-write:${lockName}`],
  );
  const hold = async (context: LockContext) => {
    await acquire();
    context.heldLocks.add(lockName);
    try {
      return await callback();
    } finally {
      context.heldLocks.delete(lockName);
      await release();
    }
  };

  if (current) return hold(current);
  return lockContext.run({ client, heldLocks: new Set<string>() }, () => hold(lockContext.getStore()!));
}
