import { Router, type IRouter } from "express";
import authRouter from "./auth";
import serviceTypesRouter from "./service-types";
import healthRouter from "./health";
import attendanceRouter from "./attendance";
import membersRouter from "./members";
import treatmentCardsRouter from "./treatment-cards";
import serviceSessionsRouter from "./service-sessions";

const router: IRouter = Router();
router.use(authRouter);
router.use(healthRouter);
router.use(serviceTypesRouter);
router.use(attendanceRouter);
router.use(membersRouter);
router.use(treatmentCardsRouter);
router.use(serviceSessionsRouter);

export default router;
