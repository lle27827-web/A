import { Router, type IRouter } from "express";
import serviceTypesRouter from "./service-types";
import healthRouter from "./health";
import authRouter from "./auth";
import attendanceRouter from "./attendance";
import membersRouter from "./members";
import treatmentCardsRouter from "./treatment-cards";
import serviceSessionsRouter from "./service-sessions";
import managersRouter from "./managers";

const router: IRouter = Router();
router.use(serviceTypesRouter);

router.use(healthRouter);
router.use(attendanceRouter);
router.use(membersRouter);
router.use(authRouter);
router.use(treatmentCardsRouter);
router.use(serviceSessionsRouter);
router.use(managersRouter);

export default router;
