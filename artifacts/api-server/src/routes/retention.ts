import { Router, type IRouter } from "express";
import { cleanupExpiredHistory } from "../lib/retention";

const router: IRouter = Router();

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
