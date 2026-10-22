import { Router, type IRouter } from "express";
import {
  DeleteRetentionDateRangeBody,
  DeleteRetentionDateRangeResponse,
  DeleteRetentionYearParams,
  DeleteRetentionYearResponse,
  ListRetentionYearsResponse,
  PreviewRetentionDateRangeQueryParams,
  PreviewRetentionDateRangeResponse,
} from "@workspace/api-zod";
import {
  cleanupExpiredHistory,
  deleteFacilityHistoryDateRange,
  deleteFacilityHistoryYear,
  listFacilityHistoryYears,
  previewFacilityHistoryDateRange,
} from "../lib/retention";
import { requireOwner } from "../lib/owner-auth";

const router: IRouter = Router();

router.get("/retention/years", requireOwner, async (_req, res, next): Promise<void> => {
  try {
    res.set("Cache-Control", "no-store");
    const years = await listFacilityHistoryYears();
    res.json(ListRetentionYearsResponse.parse(years));
  } catch (error) {
    next(error);
  }
});

router.delete("/retention/years/:year", requireOwner, async (req, res, next): Promise<void> => {
  const params = DeleteRetentionYearParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Năm không hợp lệ." });
    return;
  }

  try {
    res.set("Cache-Control", "no-store");
    const result = await deleteFacilityHistoryYear(params.data.year, req.get("Idempotency-Key"));
    if (result.deletedAttendance === 0 && result.deletedServiceSessions === 0) {
      res.status(404).json({ error: "Năm này không còn lịch sử chấm công cơ sở." });
      return;
    }
    res.json(DeleteRetentionYearResponse.parse(result));
  } catch (error) {
    next(error);
  }
});

router.get("/retention/range", requireOwner, async (req, res, next): Promise<void> => {
  const query = PreviewRetentionDateRangeQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Chọn ngày bắt đầu và ngày kết thúc hợp lệ." });
    return;
  }

  try {
    res.set("Cache-Control", "no-store");
    const summary = await previewFacilityHistoryDateRange(query.data);
    res.json(PreviewRetentionDateRangeResponse.parse(summary));
  } catch (error) {
    next(error);
  }
});

router.delete("/retention/range", requireOwner, async (req, res, next): Promise<void> => {
  const input = DeleteRetentionDateRangeBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Chọn ngày bắt đầu và ngày kết thúc hợp lệ." });
    return;
  }

  try {
    res.set("Cache-Control", "no-store");
    const result = await deleteFacilityHistoryDateRange(input.data);
    res.json(DeleteRetentionDateRangeResponse.parse(result));
  } catch (error) {
    next(error);
  }
});

router.get("/retention/cleanup", async (req, res, next): Promise<void> => {
  try {
    res.set("Cache-Control", "no-store");
    const result = await cleanupExpiredHistory();
    req.log?.info(result, "Five-year attendance retention cleanup completed");
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
