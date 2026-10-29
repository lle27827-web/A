type CacheEntry = { expiresAt: number; value: unknown[] };

export class PartitionReadCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs = 3_000) {}

  get<T>(table: string, filterKey: string, now = Date.now()): T[] | undefined {
    const key = `${table}:${filterKey}`;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return structuredClone(entry.value) as T[];
  }

  set<T>(table: string, filterKey: string, value: readonly T[], now = Date.now()): void {
    this.entries.set(`${table}:${filterKey}`, {
      expiresAt: now + this.ttlMs,
      value: structuredClone(value) as unknown[],
    });
  }

  invalidate(tables: Iterable<string>): void {
    const prefixes = [...new Set(tables)].map((table) => `${table}:`);
    for (const key of this.entries.keys()) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
