import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tasksRouter);
router.use(authRouter);

export default router;
