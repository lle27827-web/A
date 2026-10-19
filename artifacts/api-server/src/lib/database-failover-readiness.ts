const failoverOrder = [
  "database_url_1",
  "database_url",
  "database_url_3",
  "database_url_4",
] as const;

const backendLabels: Record<(typeof failoverOrder)[number], string> = {
  database_url_1: "DB1",
  database_url: "DB2",
  database_url_3: "DB3",
  database_url_4: "DB4",
};

export type CapacityProbeTargetStatus = {
  backend: string;
  configured: boolean;
  canSwitch: boolean;
  message: string;
};

export type CapacityProbeReadiness = {
  canRun: boolean;
  targetBackend?: string;
  message: string | null;
};

export function getCapacityProbeReadiness(
  activeBackend: string,
  switchTargets: readonly CapacityProbeTargetStatus[],
): CapacityProbeReadiness {
  if (activeBackend === "switching") {
    return {
      canRun: false,
      message: "Đang có thao tác chuyển database; hãy tải lại trạng thái.",
    };
  }

  const activeIndex = failoverOrder.indexOf(
    activeBackend as (typeof failoverOrder)[number],
  );
  if (activeIndex < 0) {
    return {
      canRun: false,
      message: "Chưa xác định được database đang hoạt động.",
    };
  }

  const targetBackend = failoverOrder[activeIndex + 1];
  if (!targetBackend) {
    return {
      canRun: false,
      message: `${backendLabels[failoverOrder[activeIndex]!]} là kho cuối trong chuỗi tự động; không có kho tiếp theo để thử.`,
    };
  }

  const target = switchTargets.find(
    (item) => item.backend === targetBackend,
  );
  if (!target) {
    return {
      canRun: false,
      targetBackend,
      message: `Chưa tải được trạng thái ${backendLabels[targetBackend]}. Hãy tải lại trạng thái.`,
    };
  }

  if (!target.configured || !target.canSwitch) {
    return {
      canRun: false,
      targetBackend,
      message: `${backendLabels[targetBackend]} chưa sẵn sàng: ${target.message}`,
    };
  }

  return { canRun: true, targetBackend, message: null };
}
