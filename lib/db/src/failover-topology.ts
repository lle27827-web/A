export type DatabaseBackend =
  | "database_url_1"
  | "database_url"
  | "database_url_3"
  | "database_url_4";

export type PersistedDatabaseBackend = DatabaseBackend | "switching";

export type DatabaseNodeConfig = {
  backend: DatabaseBackend;
  url: string;
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

const DATABASE_ENV = [
  {
    backend: "database_url_1",
    urlKey: "DATABASE_URL_1",
    projectIdKey: "NEON_PROJECT_ID_1",
    maxBytesKey: "DATABASE_URL_1_MAX_BYTES",
    applicationName: "so-cong-db-primary",
  },
  {
    backend: "database_url",
    urlKey: "DATABASE_URL",
    projectIdKey: "NEON_PROJECT_ID",
    maxBytesKey: "DATABASE_URL_MAX_BYTES",
    applicationName: "so-cong-db-fallback",
  },
  {
    backend: "database_url_3",
    urlKey: "DATABASE_URL_3",
    projectIdKey: "NEON_PROJECT_ID_3",
    maxBytesKey: "DATABASE_URL_3_MAX_BYTES",
    applicationName: "so-cong-db-replica-3",
  },
  {
    backend: "database_url_4",
    urlKey: "DATABASE_URL_4",
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
];

export function resolveDatabaseNodes(
  env: Record<string, string | undefined>,
): DatabaseNodeConfig[] {
  const configured = DATABASE_ENV.map((entry) => ({
    backend: entry.backend,
    url: env[entry.urlKey]?.trim() ?? "",
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

export function getReplicationEdge(
  publisher: DatabaseBackend,
  subscriber: DatabaseBackend,
): ReplicationEdge | undefined {
  return REPLICATION_EDGES.find(
    (edge) => edge.publisher === publisher && edge.subscriber === subscriber,
  );
}

export function getBackendIndex(
  backend: PersistedDatabaseBackend,
  nodes: readonly DatabaseNodeConfig[],
): number {
  if (backend === "switching") return -1;
  return nodes.findIndex((node) => node.backend === backend);
}

export function getNextBackend(
  backend: DatabaseBackend,
  nodes: readonly DatabaseNodeConfig[],
): DatabaseNodeConfig | undefined {
  const index = getBackendIndex(backend, nodes);
  return index >= 0 ? nodes[index + 1] : undefined;
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
