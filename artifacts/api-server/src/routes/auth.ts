import { Router, type IRouter } from "express";
import { GetAuthStatusResponse } from "@workspace/api-zod";
import { getOwnerAuthStatus } from "../lib/owner-auth";

const router: IRouter = Router();

router.get("/auth/status", async (req, res): Promise<void> => {
  try {
    res.json(GetAuthStatusResponse.parse(await getOwnerAuthStatus(req)));
  } catch (error) {
    req.log?.error({ err: error }, "Unable to read Clerk authentication status");
    res.status(503).json({ error: "Không thể xác minh trạng thái đăng nhập." });
  }
});

export default router;
