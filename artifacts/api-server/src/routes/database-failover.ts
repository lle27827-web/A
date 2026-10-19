import { Router, type IRouter } from "express";
import {
  GetDatabaseFailoverStatusResponse,
  RequestDatabaseFailoverBody,
  RequestDatabaseFailoverResponse,
} from "@workspace/api-zod";
import {
  getDatabaseFailoverStatus,
  requestOwnerDb1ToDb2Failover,
} from "@workspace/db";
import { requireOwner } from "../lib/owner-auth";

const router: IRouter = Router();

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
  if (!input.success || input.data.confirmation !== "DB1_TO_DB2") {
    res.status(400).json({ error: "Hãy xác nhận chuyển DB1 sang DB2." });
    return;
  }

  try {
    res.set("Cache-Control", "no-store");
    const result = await requestOwnerDb1ToDb2Failover();
    const message = result.switched
      ? "Đã chuyển sang DB2. Hệ thống không tự chuyển ngược về DB1."
      : result.activeBackend === "switching"
        ? "Đang có một lần chuyển database khác. Hãy tải lại trạng thái."
        : result.activeBackend !== "database_url_1"
          ? "DB1 không còn là database hoạt động. Thao tác này không chuyển tiếp sang database khác."
          : "Chưa chuyển database. DB1 được giữ nguyên vì trạng thái, đồng bộ hoặc dung lượng DB2 chưa đạt điều kiện an toàn.";
    const response = RequestDatabaseFailoverResponse.parse({
      ...result,
      message,
    });
    res.status(result.switched ? 200 : result.activeBackend === "switching" ? 503 : 409).json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
