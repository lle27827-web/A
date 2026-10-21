export type DatabaseBackend =
  | "database_url_1"
  | "database_url"
  | "database_url_3"
  | "database_url_4";

export type PersistedDatabaseBackend = DatabaseBackend | "switching";
export type FailoverCoordinatorBackend = DatabaseBackend | "independent";

export type DatabaseNodeConfig = {
  backend: DatabaseBackend;
  url: string;
  adminUrl?: string;
  projectId?: string;
  maxBytes: string | undefined;
  applicationName: string;
};

export type ReplicationEdge = {
  publisher: DatabaseBackend;
  subscriber: DatabaseBackend;
  publicationName: string;
  subscriptionName: string;
};

export type ReplicationTableIdentity = {
  schemaName: string;
  tableName: string;
};

const DATABASE_ENV = [
  {
    backend: "database_url_1",
    urlKey: "DATABASE_URL_1",
    adminUrlKey: "DATABASE_URL_1_DIRECT",
    projectIdKey: "NEON_PROJECT_ID_1",
    maxBytesKey: "DATABASE_URL_1_MAX_BYTES",
    applicationName: "so-cong-db-primary",
  },
  {
    backend: "database_url",
    urlKey: "DATABASE_URL",
    adminUrlKey: "DATABASE_URL_DIRECT",
    projectIdKey: "NEON_PROJECT_ID",
    maxBytesKey: "DATABASE_URL_MAX_BYTES",
    applicationName: "so-cong-db-fallback",
  },
  {
    backend: "database_url_3",
    urlKey: "DATABASE_URL_3",
    adminUrlKey: "DATABASE_URL_3_DIRECT",
    projectIdKey: "NEON_PROJECT_ID_3",
    maxBytesKey: "DATABASE_URL_3_MAX_BYTES",
    applicationName: "so-cong-db-replica-3",
  },
  {
    backend: "database_url_4",
    urlKey: "DATABASE_URL_4",
    adminUrlKey: "DATABASE_URL_4_DIRECT",
    projectIdKey: "NEON_PROJECT_ID_4",
    maxBytesKey: "DATABASE_URL_4_MAX_BYTES",
    applicationName: "so-cong-db-replica-4",
  },
] as const;

const REPLICATION_EDGES: readonly ReplicationEdge[] = [
  {
    publisher: "database_url_1",
    subscriber: "database_url",
    publicationName: "socong_db1_to_source_v1",
    subscriptionName: "socong_source_from_db1_v1",
  },
  {
    publisher: "database_url",
    subscriber: "database_url_3",
    publicationName: "socong_source_to_db3_v1",
    subscriptionName: "socong_db3_from_source_v1",
  },
  {
    publisher: "database_url_3",
    subscriber: "database_url_4",
    publicationName: "socong_db3_to_db4_v1",
    subscriptionName: "socong_db4_from_db3_v1",
  },
  {
    publisher: "database_url",
    subscriber: "database_url_1",
    publicationName: "socong_db2_to_db1_v1",
    subscriptionName: "socong_db1_from_db2_v1",
  },
  {
    publisher: "database_url_3",
    subscriber: "database_url",
    publicationName: "socong_db3_to_db2_v1",
    subscriptionName: "socong_db2_from_db3_v1",
  },
  {
    publisher: "database_url_4",
    subscriber: "database_url_3",
    publicationName: "socong_db4_to_db3_v1",
    subscriptionName: "socong_db3_from_db4_v1",
  },
];

export function resolveDatabaseNodes(
  env: Record<string, string | undefined>,
): DatabaseNodeConfig[] {
  const configured = DATABASE_ENV.map((entry) => ({
    backend: entry.backend,
    url: env[entry.urlKey]?.trim() ?? "",
    adminUrl: env[entry.adminUrlKey]?.trim() || undefined,
    projectId: env[entry.projectIdKey]?.trim() || undefined,
    maxBytes: env[entry.maxBytesKey],
    applicationName: entry.applicationName,
  }));

  if (configured[3].url && !configured[2].url) {
    throw new Error(
      "DATABASE_URL_4 requires DATABASE_URL_3 so the replication chain has no gaps.",
    );
  }

  if (!configured[0].url) {
    if (configured[2].url || configured[3].url) {
      throw new Error(
        "DATABASE_URL_3 and DATABASE_URL_4 require DATABASE_URL_1 and DATABASE_URL to preserve the failover chain.",
      );
    }
    return configured[1].url ? [configured[1]] : [];
  }

  if ((configured[2].url || configured[3].url) && !configured[1].url) {
    throw new Error(
      "DATABASE_URL_3 and DATABASE_URL_4 require DATABASE_URL as the second link in the failover chain.",
    );
  }

  const prefix: DatabaseNodeConfig[] = [];
  for (const node of configured) {
    if (!node.url) break;
    prefix.push(node);
  }
  return prefix;
}

export function resolveFailoverCoordinatorBackend(
  value: string | undefined,
  nodes: readonly Pick<DatabaseNodeConfig, "backend">[],
): DatabaseBackend {
  const backend = value?.trim() || "database_url";
  if (backend !== "database_url" && backend !== "database_url_4") {
    throw new Error(
      "DATABASE_FAILOVER_COORDINATOR_BACKEND must be database_url or database_url_4.",
    );
  }
  if (!nodes.some((node) => node.backend === backend)) {
    throw new Error(
      `DATABASE_FAILOVER_COORDINATOR_BACKEND=${backend} requires that database URL to be configured.`,
    );
  }
  return backend;
}

export function getReplicationEdge(
  publisher: DatabaseBackend,
  subscriber: DatabaseBackend,
): ReplicationEdge | undefined {
  return REPLICATION_EDGES.find(
    (edge) => edge.publisher === publisher && edge.subscriber === subscriber,
  );
}

export function replicationTableSetsMatch(
  expected: readonly ReplicationTableIdentity[],
  actual: readonly ReplicationTableIdentity[],
): boolean {
  if (expected.length === 0 || expected.length !== actual.length) return false;
  const expectedKeys = new Set(
    expected.map(({ schemaName, tableName }) => `${schemaName}\u0000${tableName}`),
  );
  if (expectedKeys.size !== expected.length) return false;
  const actualKeys = new Set(
    actual.map(({ schemaName, tableName }) => `${schemaName}\u0000${tableName}`),
  );
  if (actualKeys.size !== actual.length || actualKeys.size !== expectedKeys.size) {
    return false;
  }
  return [...expectedKeys].every((key) => actualKeys.has(key));
}

export function getBackendIndex(
  backend: PersistedDatabaseBackend,
  nodes: readonly Pick<DatabaseNodeConfig, "backend">[],
): number {
  if (backend === "switching") return -1;
  return nodes.findIndex((node) => node.backend === backend);
}

export function getNextBackend<T extends Pick<DatabaseNodeConfig, "backend">>(
  backend: DatabaseBackend,
  nodes: readonly T[],
): T | undefined {
  const index = getBackendIndex(backend, nodes);
  return index >= 0 ? nodes[index + 1] : undefined;
}

export function areAdjacentBackends<T extends Pick<DatabaseNodeConfig, "backend">>(
  currentBackend: DatabaseBackend,
  targetBackend: DatabaseBackend,
  nodes: readonly T[],
): boolean {
  const currentIndex = getBackendIndex(currentBackend, nodes);
  const targetIndex = getBackendIndex(targetBackend, nodes);
  return currentIndex >= 0 && targetIndex >= 0 && Math.abs(currentIndex - targetIndex) === 1;
}

export function isControlledDb1ToDb2Promotion(
  currentBackend: DatabaseBackend,
  targetBackend: DatabaseBackend,
): boolean {
  return currentBackend === "database_url_1" && targetBackend === "database_url";
}

export function isPersistedDatabaseBackend(
  backend: unknown,
): backend is PersistedDatabaseBackend {
  return (
    backend === "database_url_1" ||
    backend === "database_url" ||
    backend === "database_url_3" ||
    backend === "database_url_4" ||
    backend === "switching"
  );
}

export function failoverStateConstraintSupports(
  definition: string | undefined,
  backends: readonly DatabaseBackend[],
): boolean {
  if (!definition) return false;
  return backends.every((backend) => definition.includes(`'${backend}'`));
}
