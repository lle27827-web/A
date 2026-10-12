import { Router, type IRouter } from "express";
import { GetCurrentAccessResponse } from "@workspace/api-zod";
import { getAccessStatus } from "../middlewares/owner";

const router: IRouter = Router();

router.get("/auth/me", async (req, res): Promise<void> => {
  res.json(GetCurrentAccessResponse.parse(await getAccessStatus(req)));
});

export default router;
