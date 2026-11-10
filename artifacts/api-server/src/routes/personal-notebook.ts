import { Router, type IRouter, type Response } from "express";
import { sql } from "drizzle-orm";
import { db, isPartitionedStorageEnabled, readPartitionedTable } from "@workspace/db";
import {
  CreatePersonalServiceBody, CreatePersonalSessionBody, GetPersonalNotebookQueryParams,
  GetPersonalNotebookResponse, GetPersonalComparisonQueryParams, GetPersonalComparisonResponse,
  ListPersonalComparisonMembersQueryParams, ListPersonalComparisonMembersResponse,
  UpdatePersonalServiceBody, UpdatePersonalServiceParams, UpdatePersonalSessionBody, UpdatePersonalSessionParams,
  DeletePersonalServiceParams, DeletePersonalSessionParams,
  UpdatePersonalSettingsBody, SyncPersonalNotebookBody,
} from "@workspace/api-zod";
import { massageHandler, parseInput } from "./massage-errors";
import { savePersonalService, deletePersonalService, savePersonalSession, deletePersonalSession,
  getPersonalNotebook, getPersonalComparison, updatePersonalSettings } from "../lib/personal-notebook";
import { syncPersonalNotebook } from "../lib/personal-comparison";
import { MassageError } from "../lib/massage";
import { canCompareEmployee, noPermissions } from "../lib/facility-permissions";
import type { OwnerAuthStatus } from "../lib/owner-auth";
import { retentionCutoffDate } from "../lib/retention-window";
import { listMembersForPeriod } from "../lib/employee-history";

const router: IRouter = Router();
function account(value: unknown): string {
  if (typeof value !== "string" || !value) throw new MassageError(401, "Vui lòng đăng nhập.");
  return value;
}
function requireMemberComparison(res: Response, memberId: number): string {
  const status = res.locals.facilityAuth as OwnerAuthStatus | undefined;
  if (!status?.businessId) throw new MassageError(403, "Hãy chọn cơ sở đã cấp quyền đối chiếu.");
  if (!status.isOwner && !canCompareEmployee(status.permissions, memberId)) {
    throw new MassageError(403, "Bạn chưa được cấp quyền đối chiếu nhân viên này.");
  }
  return status.businessId;
}
function selectedBusinessId(res: Response): string | undefined {
  const status = res.locals.facilityAuth as OwnerAuthStatus | undefined;
  return status?.businessId ?? undefined;
}
router.put("/personal/settings", massageHandler(async (req, res) => {
  const { useFacilityRates } = parseInput(UpdatePersonalSettingsBody, req.body);
  res.json(await updatePersonalSettings(
    account(res.locals.personalUserId),
    useFacilityRates,
    req.get("Idempotency-Key") ?? undefined,
    selectedBusinessId(res),
  ));
}));
router.post("/personal/sync", massageHandler(async (req, res) => {
  const input = parseInput(SyncPersonalNotebookBody, req.body);
  const businessId = requireMemberComparison(res, input.memberId);
  res.json(await syncPersonalNotebook(
    account(res.locals.personalUserId),
    input,
    req.get("Idempotency-Key") ?? undefined,
    businessId,
  ));
}));
router.get("/personal/notebook", massageHandler(async (req, res) => {
  const { month, date } = parseInput(GetPersonalNotebookQueryParams, req.query);
  res.json(GetPersonalNotebookResponse.parse(await getPersonalNotebook(
    account(res.locals.personalUserId), month, date, selectedBusinessId(res),
  )));
}));
router.post("/personal/services", massageHandler(async (req, res) => {
  res.status(201).json(await savePersonalService(
    account(res.locals.personalUserId),
    parseInput(CreatePersonalServiceBody, req.body),
    undefined,
    req.get("Idempotency-Key") ?? undefined,
    selectedBusinessId(res),
  ));
}));
router.put("/personal/services/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdatePersonalServiceParams, req.params);
  res.json(await savePersonalService(
    account(res.locals.personalUserId),
    parseInput(UpdatePersonalServiceBody, req.body),
    id,
    req.get("Idempotency-Key") ?? undefined,
    selectedBusinessId(res),
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
    selectedBusinessId(res),
  ));
}));
router.put("/personal/sessions/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdatePersonalSessionParams, req.params);
  res.json(await savePersonalSession(
    account(res.locals.personalUserId),
    parseInput(UpdatePersonalSessionBody, req.body),
    id,
    req.get("Idempotency-Key") ?? undefined,
    selectedBusinessId(res),
  ));
}));
router.delete("/personal/sessions/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeletePersonalSessionParams, req.params);
  await deletePersonalSession(account(res.locals.personalUserId), id, req.get("Idempotency-Key") ?? undefined);
  res.sendStatus(204);
}));
router.get("/personal/comparison", massageHandler(async (req, res) => {
  const { memberId, month, date } = parseInput(GetPersonalComparisonQueryParams, req.query);
  const businessId = requireMemberComparison(res, memberId);
  res.json(GetPersonalComparisonResponse.parse(await getPersonalComparison(
    account(res.locals.personalUserId), memberId, month, date, businessId,
  )));
}));
router.get("/personal/comparison/members", massageHandler(async (req, res) => {
  const { month } = parseInput(ListPersonalComparisonMembersQueryParams, req.query);
  const status = res.locals.facilityAuth as OwnerAuthStatus | undefined;
  const businessId = status?.businessId;
  if (!businessId) throw new MassageError(403, "Hãy chọn cơ sở đã cấp quyền đối chiếu.");
  const permissions = status.permissions ?? noPermissions();
  if (!status.isOwner && !permissions.compareAllEmployees && permissions.compareEmployeeIds.length === 0) {
    throw new MassageError(403, "Bạn chưa được cấp quyền chọn nhân viên để đối chiếu.");
  }
  const rows = await listMembersForPeriod(month, undefined, businessId);
  const visible = status.isOwner ? rows : rows.filter((member) => canCompareEmployee(permissions, member.id));
  res.json(ListPersonalComparisonMembersResponse.parse(visible.map(({ id, name, deletedAt }) => ({ id, name, deletedAt }))));
}));
router.get("/history-months", massageHandler(async (_req, res) => {
  const status = res.locals.facilityAuth as OwnerAuthStatus | undefined;
  const businessId = status?.businessId;
  const p = status?.permissions ?? noPermissions();
  const current = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit",
  }).format(new Date());
  if (!businessId) {
    res.json([current]);
    return;
  }
  if (isPartitionedStorageEnabled()) {
    const [attendanceRaw, sessionsRaw, cardsRaw] = await Promise.all([
      readPartitionedTable("attendance", { businessId }),
      readPartitionedTable("service_sessions", { businessId }),
      readPartitionedTable("treatment_cards", { businessId }),
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
      WHERE a.business_id = ${businessId} AND ${attendanceScope} AND a.work_date >= ${cutoff}::date
      UNION ALL
      SELECT to_char(s.work_date, 'YYYY-MM') AS month FROM public.service_sessions s
      WHERE s.business_id = ${businessId} AND ${sessionScope}
        AND s.work_date >= ${cutoff}::date AND (s.card_id IS NULL OR EXISTS (
        SELECT 1 FROM public.treatment_cards c WHERE c.id=s.card_id
          AND c.business_id = ${businessId} AND c.deleted_at IS NULL
      ))
    ) history ORDER BY month DESC`);
  res.json([...new Set([current, ...rows.map((row) => row.month)])].sort().reverse());
}));
export default router;
