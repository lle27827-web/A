import { Router, type IRouter } from "express";
import serviceTypesRouter from "./service-types";
import healthRouter from "./health";
import authRouter from "./auth";
import attendanceRouter from "./attendance";
import membersRouter from "./members";
import treatmentCardsRouter from "./treatment-cards";
import serviceSessionsRouter from "./service-sessions";
import managersRouter from "./managers";
import { requireEditor } from "../middlewares/owner";

const router: IRouter = Router();
router.use(healthRouter);
router.use(authRouter);
// Every business-data read and write is private. Auth/health remain accessible.
router.use(requireEditor);
router.use(serviceTypesRouter);
router.use(attendanceRouter);
router.use(membersRouter);
router.use(treatmentCardsRouter);
router.use(serviceSessionsRouter);
router.use(managersRouter);

export default router;
