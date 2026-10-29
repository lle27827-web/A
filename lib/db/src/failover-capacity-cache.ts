import type { DatabaseBackend } from "./failover-topology";

type ComputeFailure = { count: number; retryAt: number };

export const FAILOVER_COMPUTE_CACHE_TTL_MS = 10 * 60_000;
const MAX_COMPUTE_API_BACKOFF_MS = 60_000;

export class FailoverCapacityCache {
  private readonly compute = new Map<DatabaseBackend, { seconds: number; checkedAt: number }>();
  private readonly failures = new Map<DatabaseBackend, ComputeFailure>();

  getComputeSeconds(backend: DatabaseBackend, now = Date.now()): number | undefined {
    const cached = this.compute.get(backend);
    if (!cached || now - cached.checkedAt > FAILOVER_COMPUTE_CACHE_TTL_MS) {
      if (cached) this.compute.delete(backend);
      return undefined;
    }
    return cached.seconds;
  }

  setComputeSeconds(backend: DatabaseBackend, seconds: number, now = Date.now()): void {
    this.compute.set(backend, { seconds, checkedAt: now });
    this.failures.delete(backend);
  }

  retryAfterMs(backend: DatabaseBackend, now = Date.now()): number {
    return Math.max(0, (this.failures.get(backend)?.retryAt ?? 0) - now);
  }

  recordApiFailure(backend: DatabaseBackend, now = Date.now()): number {
    const count = (this.failures.get(backend)?.count ?? 0) + 1;
    const backoffMs = Math.min(MAX_COMPUTE_API_BACKOFF_MS, 1_000 * 2 ** Math.min(count - 1, 6));
    this.failures.set(backend, { count, retryAt: now + backoffMs });
    return backoffMs;
  }
}
