import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, isPartitionedStorageEnabled, readPartitionedTable } from "@workspace/db";
import {
  CreatePersonalServiceBody, CreatePersonalSessionBody, GetPersonalNotebookQueryParams,
  GetPersonalNotebookResponse, GetPersonalComparisonQueryParams, GetPersonalComparisonResponse,
  UpdatePersonalServiceBody, UpdatePersonalServiceParams, UpdatePersonalSessionBody, UpdatePersonalSessionParams,
  DeletePersonalServiceParams, DeletePersonalSessionParams,
  UpdatePersonalSettingsBody, SyncPersonalNotebookBody,
} from "@workspace/api-zod";
import { massageHandler, parseInput } from "./massage-errors";
import { savePersonalService, deletePersonalService, savePersonalSession, deletePersonalSession,
  getPersonalNotebook, getPersonalComparison, updatePersonalSettings } from "../lib/personal-notebook";
import { syncPersonalNotebook } from "../lib/personal-comparison";
import { MassageError } from "../lib/massage";
import { noPermissions } from "../lib/facility-permissions";
import type { OwnerAuthStatus } from "../lib/owner-auth";
import { retentionCutoffDate } from "../lib/retention-window";

const router: IRouter = Router();
function account(value: unknown): string {
  if (typeof value !== "string" || !value) throw new MassageError(401, "Vui lòng đăng nhập.");
  return value;
}
router.put("/personal/settings", massageHandler(async (req, res) => {
  const { useFacilityRates } = parseInput(UpdatePersonalSettingsBody, req.body);
  res.json(await updatePersonalSettings(account(res.locals.personalUserId), useFacilityRates, req.get("Idempotency-Key") ?? undefined));
}));
router.post("/personal/sync", massageHandler(async (req, res) => {
  res.json(await syncPersonalNotebook(
    account(res.locals.personalUserId),
    parseInput(SyncPersonalNotebookBody, req.body),
    req.get("Idempotency-Key") ?? undefined,
  ));
}));
router.get("/personal/notebook", massageHandler(async (req, res) => {
  const { month, date } = parseInput(GetPersonalNotebookQueryParams, req.query);
  res.json(GetPersonalNotebookResponse.parse(await getPersonalNotebook(account(res.locals.personalUserId), month, date)));
}));
router.post("/personal/services", massageHandler(async (req, res) => {
  res.status(201).json(await savePersonalService(
    account(res.locals.personalUserId),
    parseInput(CreatePersonalServiceBody, req.body),
    undefined,
    req.get("Idempotency-Key") ?? undefined,
  ));
}));
router.put("/personal/services/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdatePersonalServiceParams, req.params);
  res.json(await savePersonalService(
    account(res.locals.personalUserId),
    parseInput(UpdatePersonalServiceBody, req.body),
    id,
    req.get("Idempotency-Key") ?? undefined,
  ));
}));
router.delete("/personal/services/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeletePersonalServiceParams, req.params);
  await deletePersonalService(account(res.locals.personalUserId), id, req.get("Idempotency-Key") ?? undefined);
  res.sendStatus(204);
}));
router.post("/personal/sessions", massageHandler(async (req, res) => {
  res.status(201).json(await savePersonalSession(
    account(res.locals.personalUserId),
    parseInput(CreatePersonalSessionBody, req.body),
    undefined,
    req.get("Idempotency-Key") ?? undefined,
  ));
}));
router.put("/personal/sessions/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdatePersonalSessionParams, req.params);
  res.json(await savePersonalSession(
    account(res.locals.personalUserId),
    parseInput(UpdatePersonalSessionBody, req.body),
    id,
    req.get("Idempotency-Key") ?? undefined,
  ));
}));
router.delete("/personal/sessions/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeletePersonalSessionParams, req.params);
  await deletePersonalSession(account(res.locals.personalUserId), id, req.get("Idempotency-Key") ?? undefined);
  res.sendStatus(204);
}));
router.get("/personal/comparison", massageHandler(async (req, res) => {
  const { memberId, month, date } = parseInput(GetPersonalComparisonQueryParams, req.query);
  res.json(GetPersonalComparisonResponse.parse(await getPersonalComparison(account(res.locals.personalUserId), memberId, month, date)));
}));
router.get("/history-months", massageHandler(async (_req, res) => {
  const p = (res.locals.facilityAuth as OwnerAuthStatus | undefined)?.permissions ?? noPermissions();
  if (isPartitionedStorageEnabled()) {
    const [attendanceRaw, sessionsRaw, cardsRaw] = await Promise.all([
      readPartitionedTable("attendance"),
      readPartitionedTable("service_sessions"),
      readPartitionedTable("treatment_cards"),
    ]);
    const cutoff = retentionCutoffDate();
    const attendance = attendanceRaw as unknown as (typeof import("@workspace/db").attendanceTable.$inferSelect)[];
    const sessions = sessionsRaw as unknown as (typeof import("@workspace/db").serviceSessionsTable.$inferSelect)[];
    const cards = cardsRaw as unknown as (typeof import("@workspace/db").treatmentCardsTable.$inferSelect)[];
    const activeCardIds = new Set(cards.filter((row) => row.deletedAt === null).map((row) => row.id));
    const months = new Set<string>();
    for (const row of attendance) {
      if (row.workDate < cutoff || (!p.allEmployees && !p.employeeIds.includes(row.memberId ?? -1))) continue;
      months.add(row.workDate.slice(0, 7));
    }
    for (const row of sessions) {
      if (row.workDate < cutoff || (!p.allEmployees && !p.employeeIds.includes(row.memberId ?? -1)) ||
          (row.cardId !== null && !activeCardIds.has(row.cardId))) continue;
      months.add(row.workDate.slice(0, 7));
    }
    const current = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit",
    }).format(new Date());
    res.json([...new Set([current, ...months])].sort().reverse());
    return;
  }
  const ids = p.employeeIds.length ? sql.join(p.employeeIds.map((id) => sql`${id}`), sql`, `) : sql`NULL`;
  const attendanceScope = p.allEmployees ? sql`TRUE` : sql`a.member_id IN (${ids})`;
  const sessionScope = p.allEmployees ? sql`TRUE` : sql`s.member_id IN (${ids})`;
  const cutoff = retentionCutoffDate();
  const { rows } = await db.execute<{ month: string }>(sql`
    SELECT DISTINCT month FROM (
      SELECT to_char(a.work_date, 'YYYY-MM') AS month FROM public.attendance a
      WHERE ${attendanceScope} AND a.work_date >= ${cutoff}::date
      UNION ALL
      SELECT to_char(s.work_date, 'YYYY-MM') AS month FROM public.service_sessions s
      WHERE ${sessionScope} AND s.work_date >= ${cutoff}::date AND (s.card_id IS NULL OR EXISTS (
        SELECT 1 FROM public.treatment_cards c WHERE c.id=s.card_id AND c.deleted_at IS NULL
      ))
    ) history ORDER BY month DESC`);
  const current = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date());
  res.json([...new Set([current, ...rows.map((row) => row.month)])].sort().reverse());
}));
export default router;
