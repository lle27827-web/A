import { Router, type IRouter } from "express";
import {
  GetDatabaseFailoverStatusResponse,
  RequestDatabaseFailoverBody,
  RequestDatabaseFailoverResponse,
} from "@workspace/api-zod";
import {
  getDatabaseFailoverStatus,
  getPartitionedStorageStatus,
  requestOwnerDatabaseFailover,
  requestOwnerDatabaseFailoverRecovery,
  requestOwnerForcedDatabaseFailover,
} from "@workspace/db";
import { GetDatabaseStorageStatusResponse } from "@workspace/api-zod";
import { requireOwner } from "../lib/owner-auth";

const router: IRouter = Router();
const backendNames: Record<string, string> = {
  database_url_1: "DB1",
  database_url: "DB2",
  database_url_3: "DB3",
  database_url_4: "DB4",
};

router.get("/database/storage-status", requireOwner, async (_req, res, next): Promise<void> => {
  try {
    res.set("Cache-Control", "private, no-store");
    res.json(GetDatabaseStorageStatusResponse.parse(await getPartitionedStorageStatus()));
  } catch (error) {
    next(error);
  }
});

router.get("/database/failover", requireOwner, async (_req, res, next): Promise<void> => {
  try {
    res.set("Cache-Control", "no-store");
    const status = await getDatabaseFailoverStatus();
    res.json(GetDatabaseFailoverStatusResponse.parse(status));
  } catch (error) {
    next(error);
  }
});

router.post("/database/failover", requireOwner, async (req, res, next): Promise<void> => {
  const input = RequestDatabaseFailoverBody.safeParse(req.body);
  if (
    !input.success ||
    input.data.confirmation !== (input.data.force
      ? `FORCE_${input.data.fromBackend}_TO_${input.data.targetBackend}`
      : `${input.data.fromBackend}_TO_${input.data.targetBackend}`)
  ) {
    res.status(400).json({ error: "Thông tin xác nhận chuyển database không hợp lệ." });
    return;
  }

  try {
    res.set("Cache-Control", "no-store");
    if (input.data.force) {
      const forced = await requestOwnerForcedDatabaseFailover(
        input.data.fromBackend,
        input.data.targetBackend,
      );
      res
        .status(forced.switched ? 200 : 409)
        .json(
          RequestDatabaseFailoverResponse.parse({
            switched: forced.switched,
            activeBackend: forced.activeBackend,
            message: forced.message,
          }),
        );
      return;
    }
    const result = await requestOwnerDatabaseFailover(
      input.data.fromBackend,
      input.data.targetBackend,
    );
    const message = result.switched
      ? `Đã chuyển từ ${backendNames[input.data.fromBackend]} sang ${backendNames[input.data.targetBackend]}.`
      : result.activeBackend === "switching"
        ? "Đang có một lần chuyển database khác. Hãy tải lại trạng thái."
        : result.activeBackend !== input.data.fromBackend
          ? "Database hoạt động đã thay đổi. Hãy tải lại trạng thái trước khi thử lại."
          : "Chưa chuyển database. Kho hiện tại được giữ nguyên vì trạng thái, đồng bộ hoặc dung lượng chưa đạt điều kiện an toàn.";
    const response = RequestDatabaseFailoverResponse.parse({
      ...result,
      message,
    });
    res.status(result.switched ? 200 : result.activeBackend === "switching" ? 503 : 409).json(response);
  } catch (error) {
    next(error);
  }
});

router.post("/database/failover/recover", requireOwner, async (req, res, next): Promise<void> => {
  const input = RequestDatabaseFailoverBody.safeParse(req.body);
  if (
    !input.success ||
    input.data.force ||
    input.data.confirmation !==
      `${input.data.fromBackend}_TO_${input.data.targetBackend}`
  ) {
    res.status(400).json({ error: "Thông tin xác nhận khôi phục database không hợp lệ." });
    return;
  }

  try {
    res.set("Cache-Control", "no-store");
    const result = await requestOwnerDatabaseFailoverRecovery(
      input.data.fromBackend,
      input.data.targetBackend,
    );
    const message = result.recovered
      ? `Đã khôi phục kho nguồn ${backendNames[result.activeBackend]}.`
      : result.activeBackend === "switching"
        ? "Chưa thể khôi phục an toàn. Hệ thống vẫn khóa ghi để tránh lệch dữ liệu."
        : "Không có lần chuyển đang chờ khôi phục.";
    res
      .status(result.recovered ? 200 : 409)
      .json(
        RequestDatabaseFailoverResponse.parse({
          switched: result.recovered,
          activeBackend: result.activeBackend,
          message,
        }),
      );
  } catch (error) {
    next(error);
  }
});

export default router;
