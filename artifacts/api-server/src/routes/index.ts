import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import authRouter from "./auth";
import attendanceRouter from "./attendance";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tasksRouter);
router.use(attendanceRouter);
router.use(authRouter);

export default router;
