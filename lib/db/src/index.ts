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
  isDatabaseCapacityError,
  isDatabaseAvailabilityError,
  isDatabaseFailoverTriggerError,
  isSameDatabaseFailureDomain,
} from "./failover-utils";
export {
  applyPartitionMutations,
  buildPartitionEventInsertBatch,
  comparePartitionRevisions,
  makePartitionEntityKey,
  type PartitionMutation,
  type PartitionMutationAction,
} from "./storage-partitioning";
export { normalizePartitionDatabaseRow, personalTableReadPredicates } from "./partitioned-row";
export { PartitionReadCache } from "./partition-read-cache";
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
export { hasPartitionReadQuorum, PARTITION_READ_QUORUM, readWithMinimumReplicaCount } from "./partition-read-plan";
export type { DomainWriteRoute, PartitionDataDomain } from "./domain-partitioning";
export * from "./schema";
