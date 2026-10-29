import {
  areAdjacentBackends,
  type DatabaseBackend,
} from "./failover-topology";

export const FAILOVER_SWITCH_STALE_AFTER_MS = 3 * 60_000;

export type StaleFailoverRecoveryDecision =
  | { action: "wait"; message: string }
  | { action: "restore_source"; sourceBackend: DatabaseBackend; message: string }
  | { action: "manual"; message: string };

export function getForcedFailoverBlocker(input: {
  enabled: boolean;
  production: boolean;
  sourceBackend: DatabaseBackend;
  targetBackend: DatabaseBackend;
  configuredBackends: readonly { backend: DatabaseBackend }[];
  coordinatorAvailable: boolean;
  independentCoordinator: boolean;
  coordinatorBackend: DatabaseBackend;
  sourceReachable: boolean;
  targetReachable: boolean;
  targetHasCapacity: boolean;
}): string | null {
  if (!input.enabled || !input.production) {
    return "Chuyển cưỡng bức chưa được bật trên môi trường production.";
  }
  if (
    !areAdjacentBackends(
      input.sourceBackend,
      input.targetBackend,
      input.configuredBackends,
    )
  ) {
    return "Kho đích không liền kề với kho nguồn.";
  }
  if (!input.coordinatorAvailable) {
    return "Bộ điều phối failover chưa sẵn sàng.";
  }
  if (!input.independentCoordinator && input.coordinatorBackend === input.sourceBackend) {
    return "Không thể chuyển cưỡng bức khi kho nguồn đồng thời là bộ điều phối.";
  }
  if (input.sourceReachable) {
    return "Kho nguồn vẫn phản hồi; không cho phép chuyển cưỡng bức.";
  }
  if (!input.targetReachable) {
    return "Kho đích không vượt qua kiểm tra kết nối mới.";
  }
  if (!input.targetHasCapacity) {
    return "Không xác minh được dung lượng và CU còn trống của kho đích.";
  }
  return null;
}

export function evaluateStaleFailoverRecovery(input: {
  now: number;
  startedAt: number | null;
  sourceBackend: DatabaseBackend | null;
  targetBackend: DatabaseBackend | null;
  manualRecoveryRequired: boolean;
  manualConfirmation?: boolean;
  sourceReachable: boolean;
  forwardSubscriptionEnabled: boolean | null;
  reverseSubscriptionEnabled: boolean | null;
  configuredBackends: readonly { backend: DatabaseBackend }[];
}): StaleFailoverRecoveryDecision {
  const age = input.startedAt === null ? Number.POSITIVE_INFINITY : input.now - input.startedAt;
  if (age < FAILOVER_SWITCH_STALE_AFTER_MS) {
    return {
      action: "wait",
      message: "Đang chuyển database. Hệ thống sẽ tự kiểm tra lại sau.",
    };
  }
  if (input.manualRecoveryRequired && !input.manualConfirmation) {
    return {
      action: "manual",
      message: "Lần chuyển database đã quá thời hạn; cần chủ sở hữu xác nhận xử lý. Hệ thống đang tạm khóa ghi để tránh lệch dữ liệu.",
    };
  }
  if (!input.sourceBackend || !input.targetBackend || input.sourceBackend === input.targetBackend) {
    return {
      action: "manual",
      message: "Không xác định được kho nguồn và kho đích của lần chuyển bị gián đoạn. Hệ thống đang tạm khóa ghi.",
    };
  }
  if (
    !areAdjacentBackends(
      input.sourceBackend,
      input.targetBackend,
      input.configuredBackends,
    )
  ) {
    return {
      action: "manual",
      message: "Kho nguồn và kho đích không liền kề; cần chủ sở hữu kiểm tra trước khi khôi phục.",
    };
  }
  if (!input.sourceReachable) {
    return {
      action: "manual",
      message: "Kho nguồn chưa kết nối được; hệ thống không tự quay lại để tránh mất dữ liệu.",
    };
  }
  if (
    input.forwardSubscriptionEnabled !== true ||
    input.reverseSubscriptionEnabled !== false
  ) {
    return {
      action: "manual",
      message: "Không xác minh được replication một chiều an toàn; hệ thống đang tạm khóa ghi.",
    };
  }
  return {
    action: "restore_source",
    sourceBackend: input.sourceBackend,
    message: "Đã khôi phục kho nguồn sau khi xác minh replication an toàn.",
  };
}
