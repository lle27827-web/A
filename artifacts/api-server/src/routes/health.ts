import { Router, type IRouter } from "express";
import {
  GetDatabaseFailoverStatusResponse,
  HealthCheckResponse,
} from "@workspace/api-zod";
import { getDatabaseFailoverStatus } from "@workspace/db";
import { requireOwner } from "../lib/owner-auth";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/database-failover/status", requireOwner, async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(
      GetDatabaseFailoverStatusResponse.parse(await getDatabaseFailoverStatus()),
    );
  } catch (error) {
    next(error);
  }
});

export default router;
