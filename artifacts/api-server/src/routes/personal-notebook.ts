import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  CreatePersonalServiceBody, CreatePersonalSessionBody, GetPersonalNotebookQueryParams,
  GetPersonalNotebookResponse, GetPersonalComparisonQueryParams, GetPersonalComparisonResponse,
  UpdatePersonalServiceBody, UpdatePersonalServiceParams, UpdatePersonalSessionBody, UpdatePersonalSessionParams,
  DeletePersonalServiceParams, DeletePersonalSessionParams,
} from "@workspace/api-zod";
import { massageHandler, parseInput } from "./massage-errors";
import { savePersonalService, deletePersonalService, savePersonalSession, deletePersonalSession,
  getPersonalNotebook, getPersonalComparison } from "../lib/personal-notebook";
import { MassageError } from "../lib/massage";

const router: IRouter = Router();
function account(value: unknown): string {
  if (typeof value !== "string" || !value) throw new MassageError(401, "Vui lòng đăng nhập.");
  return value;
}
router.get("/personal/notebook", massageHandler(async (req, res) => {
  const { month, date } = parseInput(GetPersonalNotebookQueryParams, req.query);
  res.json(GetPersonalNotebookResponse.parse(await getPersonalNotebook(account(res.locals.personalUserId), month, date)));
}));
router.post("/personal/services", massageHandler(async (req, res) => {
  res.status(201).json(await savePersonalService(account(res.locals.personalUserId), parseInput(CreatePersonalServiceBody, req.body)));
}));
router.put("/personal/services/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdatePersonalServiceParams, req.params);
  res.json(await savePersonalService(account(res.locals.personalUserId), parseInput(UpdatePersonalServiceBody, req.body), id));
}));
router.delete("/personal/services/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeletePersonalServiceParams, req.params);
  await deletePersonalService(account(res.locals.personalUserId), id);
  res.sendStatus(204);
}));
router.post("/personal/sessions", massageHandler(async (req, res) => {
  res.status(201).json(await savePersonalSession(account(res.locals.personalUserId), parseInput(CreatePersonalSessionBody, req.body)));
}));
router.put("/personal/sessions/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdatePersonalSessionParams, req.params);
  res.json(await savePersonalSession(account(res.locals.personalUserId), parseInput(UpdatePersonalSessionBody, req.body), id));
}));
router.delete("/personal/sessions/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeletePersonalSessionParams, req.params);
  await deletePersonalSession(account(res.locals.personalUserId), id);
  res.sendStatus(204);
}));
router.get("/personal/comparison", massageHandler(async (req, res) => {
  const { memberId, month, date } = parseInput(GetPersonalComparisonQueryParams, req.query);
  res.json(GetPersonalComparisonResponse.parse(await getPersonalComparison(account(res.locals.personalUserId), memberId, month, date)));
}));
router.get("/history-months", massageHandler(async (_req, res) => {
  const { rows } = await db.execute<{ month: string }>(sql`
    SELECT DISTINCT month FROM (
      SELECT to_char(a.work_date, 'YYYY-MM') AS month FROM public.attendance a
      UNION ALL
      SELECT to_char(s.work_date, 'YYYY-MM') AS month FROM public.service_sessions s
      WHERE s.card_id IS NULL OR EXISTS (
        SELECT 1 FROM public.treatment_cards c WHERE c.id=s.card_id AND c.deleted_at IS NULL
      )
    ) history ORDER BY month DESC`);
  const current = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date());
  res.json([...new Set([current, ...rows.map((row) => row.month)])].sort().reverse());
}));
export default router;
