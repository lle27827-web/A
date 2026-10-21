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
  type PartitionMutation,
  type PartitionMutationAction,
} from "./storage-partitioning";
export * from "./schema";
