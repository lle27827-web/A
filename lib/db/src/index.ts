export {
  db,
  pool,
  getDatabaseFailoverStatus,
  requestOwnerDatabaseFailover,
  refreshDatabaseBackend,
  DatabaseFailoverInProgressError,
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
  comparePartitionRevisions,
  makePartitionEntityKey,
  nextPartitionWriteBackend,
  resolvePartitionWritePair,
  resolvePartitionWriteBackend,
  PartitionRoutingError,
  type PartitionMutation,
  type PartitionMutationAction,
  type PartitionCapacityState,
  type PartitionReplicaPair,
} from "./storage-partitioning";
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
export * from "./schema";
