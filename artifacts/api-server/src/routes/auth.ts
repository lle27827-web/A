import { Router, type IRouter } from "express";
import { GetCurrentAccessResponse } from "@workspace/api-zod";
import { getAccessStatus, requireSignedIn } from "../middlewares/owner";

const router: IRouter = Router();

router.get("/auth/me", requireSignedIn, async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    res.json(GetCurrentAccessResponse.parse(await getAccessStatus(req)));
  } catch {
    res.status(503).json({ error: "Không thể xác minh quyền tài khoản. Vui lòng thử lại." });
  }
});

export default router;
