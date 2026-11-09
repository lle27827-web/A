function firstNonEmptyEnvValue(env, keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function resolveConfiguredStores(env) {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL must be configured for the Vercel API.");
  }
  const candidates = [
    {
      backend: "database_url_1",
      label: "DB1",
      url: firstNonEmptyEnvValue(env, [
        "NEON_DB1_DIRECT_URL",
        "DATABASE_URL_1_DIRECT",
        "DATABASE_URL_1",
      ]),
    },
    {
      backend: "database_url",
      label: "DB2",
      url: firstNonEmptyEnvValue(env, [
        "NEON_DB2_DIRECT_URL",
        "DATABASE_URL_DIRECT",
        "NEON_SOURCE_DIRECT_URL",
        "DATABASE_URL",
      ]),
    },
    {
      backend: "database_url_3",
      label: "DB3",
      url: firstNonEmptyEnvValue(env, [
        "NEON_DB3_DIRECT_URL",
        "MIGRATE_DATABASE_URL_3_DIRECT",
        "DATABASE_URL_3_DIRECT",
        "DATABASE_URL_3",
      ]),
    },
    {
      backend: "database_url_4",
      label: "DB4",
      url: firstNonEmptyEnvValue(env, [
        "NEON_DB4_DIRECT_URL",
        "MIGRATE_DATABASE_URL_4_DIRECT",
        "DATABASE_URL_4_DIRECT",
        "DATABASE_URL_4",
      ]),
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

export function assertFourDistinctStores(stores) {
  const required = [
    ["database_url_1", "DB1"],
    ["database_url", "DB2"],
    ["database_url_3", "DB3"],
    ["database_url_4", "DB4"],
  ];
  const configuredBackends = new Set(stores.map((store) => store.backend));
  const missingOrDuplicate = required
    .filter(([backend]) => !configuredBackends.has(backend))
    .map(([, label]) => label);
  if (missingOrDuplicate.length) {
    throw new Error(
      `Four distinct Neon databases are required; resolved ${stores.length}/4. ` +
      `Missing or duplicate store: ${missingOrDuplicate.join(", ")}. Check the Vercel database variables.`,
    );
  }
}

const directStoreCandidates = [
  {
    backend: "database_url_1",
    label: "DB1",
    variables: ["NEON_DB1_DIRECT_URL", "DATABASE_URL_1_DIRECT"],
    runtimeUrlKey: "DATABASE_URL_1",
  },
  {
    backend: "database_url",
    label: "DB2",
    variables: ["NEON_DB2_DIRECT_URL", "DATABASE_URL_DIRECT", "NEON_SOURCE_DIRECT_URL"],
    runtimeUrlKey: "DATABASE_URL",
  },
  {
    backend: "database_url_3",
    label: "DB3",
    variables: [
      "NEON_DB3_DIRECT_URL",
      "MIGRATE_DATABASE_URL_3_DIRECT",
      "DATABASE_URL_3_DIRECT",
    ],
    runtimeUrlKey: "DATABASE_URL_3",
  },
  {
    backend: "database_url_4",
    label: "DB4",
    variables: [
      "NEON_DB4_DIRECT_URL",
      "MIGRATE_DATABASE_URL_4_DIRECT",
      "DATABASE_URL_4_DIRECT",
    ],
    runtimeUrlKey: "DATABASE_URL_4",
  },
];

export function resolveDirectConfiguredStores(env) {
  const seen = new Set();
  return directStoreCandidates.map(({ backend, label, variables, runtimeUrlKey }) => {
    const configuredDirect = variables
      .map((name) => ({ name, url: env[name]?.trim() }))
      .find(({ url }) => Boolean(url));
    const sourceName = configuredDirect?.name ?? runtimeUrlKey;
    const url = configuredDirect?.url ?? env[runtimeUrlKey]?.trim();
    const guidance = `${variables.join(" or ")} or a direct ${runtimeUrlKey}`;
    if (!url) {
      throw new Error(
        `${label} requires a direct Neon endpoint. Set ${guidance}.`,
      );
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(
        `${label} variable ${sourceName} is not a valid database URL. Check ${guidance}.`,
      );
    }

    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      throw new Error(
        `${label} variable ${sourceName} must use postgres:// or postgresql://.`,
      );
    }

    if (/-pooler(?:\.|$)/i.test(parsed.hostname)) {
      throw new Error(
        `${label} variable ${sourceName} points to a pooler endpoint; use a direct Neon URL without -pooler.`,
      );
    }

    const key = `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
    if (seen.has(key)) {
      throw new Error(
        `Four distinct Neon databases are required; ${label} duplicates another store.`,
      );
    }
    seen.add(key);
    return { backend, label, url };
  });
}

export function resolveMigrationTargetUrl(env) {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL must be configured for the migration target.");
  }
  try {
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL for the migration target.");
  }
  return url;
}

export function resolveFailoverCoordinatorUrl(env, stores) {
  if (env.DATABASE_FAILOVER_COORDINATOR_URL?.trim()) {
    return env.DATABASE_FAILOVER_COORDINATOR_URL.trim();
  }
  const backend =
    env.DATABASE_FAILOVER_COORDINATOR_BACKEND?.trim() ?? "database_url_4";
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
