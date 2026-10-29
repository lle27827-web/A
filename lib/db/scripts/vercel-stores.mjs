export function resolveConfiguredStores(env) {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL must be configured for the Vercel API.");
  }
  const candidates = [
    {
      backend: "database_url_1",
      label: "DB1",
      url: env.NEON_DB1_DIRECT_URL ?? env.DATABASE_URL_1_DIRECT ?? env.DATABASE_URL_1,
    },
    {
      backend: "database_url",
      label: "DB2",
      url: env.DATABASE_URL_DIRECT ?? env.NEON_SOURCE_DIRECT_URL ?? env.DATABASE_URL,
    },
    {
      backend: "database_url_3",
      label: "DB3",
      url:
        env.MIGRATE_DATABASE_URL_3_DIRECT ??
        env.DATABASE_URL_3_DIRECT ??
        env.DATABASE_URL_3,
    },
    {
      backend: "database_url_4",
      label: "DB4",
      url:
        env.MIGRATE_DATABASE_URL_4_DIRECT ??
        env.DATABASE_URL_4_DIRECT ??
        env.DATABASE_URL_4,
    },
  ];

  const seen = new Set();
  const stores = [];
  for (const candidate of candidates) {
    const url = candidate.url?.trim();
    if (!url) continue;
    let key;
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/-pooler(?=\.|$)/i, "").toLowerCase();
      key = `${hostname}${parsed.pathname}`;
    } catch {
      throw new Error(`${candidate.label} has an invalid database URL.`);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    stores.push({ backend: candidate.backend, label: candidate.label, url });
  }
  return stores;
}

export function resolveFailoverCoordinatorUrl(env, stores) {
  if (env.DATABASE_FAILOVER_COORDINATOR_URL?.trim()) {
    return env.DATABASE_FAILOVER_COORDINATOR_URL.trim();
  }
  const backend =
    env.DATABASE_FAILOVER_COORDINATOR_BACKEND?.trim() ?? "database_url";
  const failoverConfigured = stores.some(
    (store) => store.backend !== "database_url",
  );
  if (!failoverConfigured && !env.DATABASE_FAILOVER_COORDINATOR_BACKEND) {
    return null;
  }
  if (
    !["database_url_1", "database_url", "database_url_3", "database_url_4"].includes(
      backend,
    )
  ) {
    throw new Error("A valid failover coordinator URL or configured backend is required.");
  }
  const store = stores.find((candidate) => candidate.backend === backend);
  if (!store) {
    throw new Error("The configured failover coordinator database is missing.");
  }
  return store.url;
}
