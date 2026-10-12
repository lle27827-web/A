import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import attendanceRouter from "./attendance";
import membersRouter from "./members";

const router: IRouter = Router();

router.use(healthRouter);
router.use(attendanceRouter);
router.use(membersRouter);
router.use(authRouter);

export default router;
