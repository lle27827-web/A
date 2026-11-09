export {
  db,
  pool,
  getDatabaseFailoverStatus,
  requestOwnerDatabaseFailover,
  requestOwnerDatabaseFailoverRecovery,
  requestOwnerForcedDatabaseFailover,
  refreshDatabaseBackend,
  DatabaseFailoverInProgressError,
  withBusinessRegistryClient,
} from "./runtime-failover-chain";
export {
  hasReachedDatabaseCapacity,
  isDatabaseCapacityError,
  isDatabaseAvailabilityError,
  isDatabaseFailoverTriggerError,
  isSameDatabaseFailureDomain,
  parseDatabaseCapacityLimit,
} from "./failover-utils";
export {
  applyPartitionMutations,
  buildPartitionEventInsertBatch,
  comparePartitionRevisions,
  makePartitionEntityKey,
  nextPartitionWriteBackend,
  resolvePartitionWritePair,
  resolvePartitionWriteBackend,
  resolvePartitionComputeState,
  type PartitionComputeSnapshot,
  shouldAdvancePartitionCursor,
  PartitionRoutingError,
  type PartitionMutation,
  type PartitionMutationAction,
  type PartitionCapacityState,
  type PartitionReplicaPair,
} from "./storage-partitioning";
export { normalizePartitionDatabaseRow, personalTableReadPredicates } from "./partitioned-row";
export { PartitionReadCache } from "./partition-read-cache";
export { FailoverCapacityCache, FAILOVER_COMPUTE_CACHE_TTL_MS } from "./failover-capacity-cache";
export {
  evaluateStaleFailoverRecovery,
  FAILOVER_SWITCH_STALE_AFTER_MS,
} from "./failover-recovery";
export {
  appendReservedPartitionOperation,
  getReservedPartitionOperation,
  hashPartitionRequest,
  getPartitionedStorageStatus,
  isPartitionedStorageEnabled,
  partitionEntityKey,
  readPartitionedGrantByEmail,
  readPartitionedGrantsByGrantor,
  readPartitionedRowById,
  reconcilePartitionOperation,
  readPartitionedTable,
  reservePartitionOperation,
  withPartitionWriteMutex,
  PartitionStorageError,
  type ReservedOperation,
  type PartitionedStorageStatus,
} from "./partitioned-storage-runtime";
export type { MutationDraft } from "./partitioned-storage-runtime";
export {
  getDomainAvailabilityFallbackRoutes,
  getPreferredDomainWriteRoutes,
  getPartitionActionEntityTypes,
  getPartitionDataDomain,
  resolveDomainWriteRoutes,
} from "./domain-partitioning";
export { readWithMinimumReplicaCount } from "./partition-read-plan";
export type { DomainWriteRoute, PartitionDataDomain } from "./domain-partitioning";
export * from "./schema";
