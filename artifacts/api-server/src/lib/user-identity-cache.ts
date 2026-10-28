type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

export function createAsyncTtlCache<T>(ttlMs: number, maxEntries: number) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || !Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("Cache TTL and size must be positive integers.");
  }

  const entries = new Map<string, CacheEntry<T>>();

  return {
    async get(key: string, load: () => Promise<T>): Promise<T> {
      const existing = entries.get(key);
      if (existing && existing.expiresAt > Date.now()) {
        entries.delete(key);
        entries.set(key, existing);
        return existing.value;
      }
      if (existing) entries.delete(key);

      const entry: CacheEntry<T> = {
        expiresAt: Date.now() + ttlMs,
        value: Promise.resolve().then(load),
      };
      entries.set(key, entry);
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }

      try {
        return await entry.value;
      } catch (error) {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      }
    },
    clear(key?: string) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
}
