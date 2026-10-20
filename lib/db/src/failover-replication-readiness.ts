import type { ReplicationTableIdentity } from "./failover-topology";

type ReplicationBlocker =
  | { kind: "edge_missing" }
  | { kind: "subscription_missing"; subscriptionName: string }
  | { kind: "subscription_disabled"; subscriptionName: string }
  | { kind: "no_application_tables" }
  | {
      kind: "publication_mismatch";
      missingTables: readonly ReplicationTableIdentity[];
      hasExtraTables: boolean;
    }
  | {
      kind: "subscription_mismatch";
      missingTables: readonly ReplicationTableIdentity[];
      hasExtraTables: boolean;
    }
  | { kind: "pending_tables"; tables: readonly ReplicationTableIdentity[] }
  | { kind: "apply_worker_missing"; subscriptionName: string }
  | { kind: "lsn_missing" }
  | { kind: "lag"; bytes: string }
  | { kind: "query_failed" };

function formatTableList(tables: readonly ReplicationTableIdentity[]): string {
  const visibleTables = tables
    .slice(0, 4)
    .map(({ schemaName, tableName }) => `${schemaName}.${tableName}`);
  const remaining = tables.length - visibleTables.length;
  return remaining > 0
    ? `${visibleTables.join(", ")} và ${remaining} bảng khác`
    : visibleTables.join(", ");
}

function describeTableMismatch(
  label: string,
  missingTables: readonly ReplicationTableIdentity[],
  hasExtraTables: boolean,
): string {
  if (missingTables.length > 0 && hasExtraTables) {
    return `${label} chưa khớp cấu trúc bảng; thiếu ${formatTableList(missingTables)} và có bảng ngoài danh sách ứng dụng.`;
  }
  if (missingTables.length > 0) {
    return `${label} chưa có đủ bảng: ${formatTableList(missingTables)}.`;
  }
  return `${label} có bảng ngoài danh sách ứng dụng; cần kiểm tra lại cấu hình.`;
}

export function describeReplicationBlocker(
  blocker: ReplicationBlocker,
): string {
  switch (blocker.kind) {
    case "edge_missing":
      return "Chưa cấu hình liên kết logical replication cho cặp kho này.";
    case "subscription_missing":
      return `Chưa tạo subscription “${blocker.subscriptionName}” trên kho đích.`;
    case "subscription_disabled":
      return `Subscription “${blocker.subscriptionName}” đang bị tắt trên kho đích.`;
    case "no_application_tables":
      return "Kho nguồn chưa có bảng ứng dụng để đồng bộ.";
    case "publication_mismatch":
      return describeTableMismatch(
        "Publication trên kho nguồn",
        blocker.missingTables,
        blocker.hasExtraTables,
      );
    case "subscription_mismatch":
      return describeTableMismatch(
        "Subscription trên kho đích",
        blocker.missingTables,
        blocker.hasExtraTables,
      );
    case "pending_tables":
      return `Đồng bộ ban đầu chưa xong ở các bảng: ${formatTableList(blocker.tables)}.`;
    case "apply_worker_missing":
      return `Chưa thấy worker apply của subscription “${blocker.subscriptionName}”; kiểm tra trạng thái kết nối replication.`;
    case "lsn_missing":
      return "Chưa đọc được vị trí WAL để xác nhận replication đã đồng bộ.";
    case "lag":
      return `Replication còn trễ khoảng ${blocker.bytes} byte; chờ đồng bộ rồi tải lại trạng thái.`;
    case "query_failed":
      return "Không truy vấn được trạng thái replication; kiểm tra kết nối trực tiếp và quyền PostgreSQL.";
  }
}
