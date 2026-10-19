import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  GetDatabaseFailoverStatusResponse,
  RequestDatabaseFailoverBody,
  RequestDatabaseFailoverResponse,
} from "@workspace/api-zod";
import {
  appointmentsTable,
  db,
  getDatabaseFailoverStatus,
  refreshDatabaseBackend,
  requestOwnerDatabaseFailover,
} from "@workspace/db";
import { requireOwner } from "../lib/owner-auth";
import { getCapacityProbeReadiness } from "../lib/database-failover-readiness";

const router: IRouter = Router();
const backendNames: Record<string, string> = {
  database_url_1: "DB1",
  database_url: "DB2",
  database_url_3: "DB3",
  database_url_4: "DB4",
};

router.get("/database/failover", requireOwner, async (_req, res, next): Promise<void> => {
  try {
    res.set("Cache-Control", "no-store");
    const status = await getDatabaseFailoverStatus();
    res.json(GetDatabaseFailoverStatusResponse.parse(status));
  } catch (error) {
    next(error);
  }
});

router.post("/database/failover/capacity-probe", requireOwner, async (req, res, next): Promise<void> => {
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
    res.status(409).json({ error: "Bài thử CU chỉ được chạy trên Vercel Production." });
    return;
  }

  const probeName = `KIEM_THU_DB_${randomUUID().replaceAll("-", "")}`;
  let beforeBackend: string;
  try {
    const status = await getDatabaseFailoverStatus();
    const readiness = getCapacityProbeReadiness(
      status.activeBackend,
      status.switchTargets,
    );
    if (!readiness.canRun) {
      res.set("Cache-Control", "no-store").status(409).json({
        error: readiness.message ?? "Kho dự phòng chưa sẵn sàng để kiểm thử.",
      });
      return;
    }

    beforeBackend = await refreshDatabaseBackend();
    if (beforeBackend !== status.activeBackend) {
      res.set("Cache-Control", "no-store").json({
        activeBackend: beforeBackend,
        switched: true,
      });
      return;
    }
  } catch (error) {
    next(error);
    return;
  }

  try {
    await db.transaction(async (tx) => {
      const [probe] = await tx.insert(appointmentsTable).values({
        customerName: probeName,
        phone: "00000000000",
        scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        request: "Dữ liệu kiểm thử failover",
        note: "Tự động xóa trong cùng giao dịch.",
      }).returning({ id: appointmentsTable.id });
      if (!probe) throw new Error("Không tạo được bản ghi kiểm thử.");
      await tx.delete(appointmentsTable).where(eq(appointmentsTable.id, probe.id));
    });
  } catch (error) {
    // The database wrapper can promote a standby when the write reports a capacity error.
    const activeBackend = await refreshDatabaseBackend().catch(() => null);
    if (!activeBackend || activeBackend === beforeBackend) {
      next(error);
      return;
    }
    res.set("Cache-Control", "no-store").json({ activeBackend, switched: true });
    return;
  }

  try {
    const activeBackend = await refreshDatabaseBackend();
    res.set("Cache-Control", "no-store").json({
      activeBackend,
      switched: activeBackend !== beforeBackend,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/database/failover", requireOwner, async (req, res, next): Promise<void> => {
  const input = RequestDatabaseFailoverBody.safeParse(req.body);
  if (
    !input.success ||
    input.data.confirmation !==
      `${input.data.fromBackend}_TO_${input.data.targetBackend}`
  ) {
    res.status(400).json({ error: "Thông tin xác nhận chuyển database không hợp lệ." });
    return;
  }

  try {
    res.set("Cache-Control", "no-store");
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

export default router;
