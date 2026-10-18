import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { cardUsageHistoryTable, db, serviceSessionsTable } from "@workspace/db";
import {
  CreateServiceSessionBody, CreateServiceSessionResponse, DeleteServiceSessionParams,
  GetMassageSummaryQueryParams, GetMassageSummaryResponse, GetMemberPayrollQueryParams, GetMemberPayrollResponse,
  ListServiceSessionsQueryParams, ListServiceSessionsResponse,
  UpdateServiceSessionBody, UpdateServiceSessionParams, UpdateServiceSessionResponse,
} from "@workspace/api-zod";
import { deleteSession, MassageError, monthBounds, retainedDate, retainedMonthBounds, saveSession, sessionResponse, validDate } from "../lib/massage";
import { retentionCutoffDate } from "../lib/retention-window";
import { massageHandler, parseInput } from "./massage-errors";
import { getFacilityRevenue } from "../lib/facility-revenue";
import { listMembersForPeriod } from "../lib/employee-history";
import { noPermissions } from "../lib/facility-permissions";
import type { OwnerAuthStatus } from "../lib/owner-auth";

const router: IRouter = Router();
const mutationScope = (auth: OwnerAuthStatus | undefined) => auth?.isOwner ? undefined : auth?.permissions ?? noPermissions();
router.get("/service-sessions", massageHandler(async (req, res) => {
  const q = parseInput(ListServiceSessionsQueryParams, req.query);
  const filters = [];
  const archivedFilters = [];
  const permissions = (res.locals.facilityAuth as OwnerAuthStatus | undefined)?.permissions ?? noPermissions();
  if (!q.cardId && !permissions.allEmployees) filters.push(inArray(serviceSessionsTable.memberId, permissions.employeeIds));
  if (q.memberId) filters.push(eq(serviceSessionsTable.memberId, q.memberId));
  if (q.cardId) filters.push(eq(serviceSessionsTable.cardId, q.cardId));
  if (q.cardId) archivedFilters.push(eq(cardUsageHistoryTable.cardId, q.cardId));
  if (q.memberId) archivedFilters.push(eq(cardUsageHistoryTable.memberId, q.memberId));
  if (q.date) {
    if (!q.cardId) retainedDate(q.date);
    const date = validDate(q.date);
    filters.push(eq(serviceSessionsTable.workDate, date));
    archivedFilters.push(eq(cardUsageHistoryTable.workDate, date));
  }
  if (q.month) {
    const { start, end } = q.cardId ? monthBounds(q.month) : retainedMonthBounds(q.month);
    filters.push(gte(serviceSessionsTable.workDate, start), lt(serviceSessionsTable.workDate, end));
    archivedFilters.push(gte(cardUsageHistoryTable.workDate, start), lt(cardUsageHistoryTable.workDate, end));
  }
  if (!q.cardId && !q.date && !q.month) filters.push(gte(serviceSessionsTable.workDate, retentionCutoffDate()));
  const rows = await db.select().from(serviceSessionsTable).where(and(...filters))
    .orderBy(desc(serviceSessionsTable.workDate), desc(serviceSessionsTable.id));
  const archivedRows = q.cardId ? await db.select().from(cardUsageHistoryTable).where(and(...archivedFilters,
    ))
    .orderBy(desc(cardUsageHistoryTable.workDate), desc(cardUsageHistoryTable.sourceSessionId)) : [];
  const archivedSessions = archivedRows.map((row) => ({
    id: row.sourceSessionId,
    cardId: row.cardId,
    memberId: row.memberId,
    employeeName: row.employeeName,
    customerName: row.customerName,
    serviceTypeId: row.serviceTypeId,
    serviceType: row.serviceType,
    workDate: row.workDate,
    minutes: row.minutes,
    customerHourlyRate: row.customerHourlyRate,
    customerCharge: row.customerCharge,
    hourlyRate: row.hourlyRate,
    earnings: row.earnings,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    archived: true,
  }));
  res.json(ListServiceSessionsResponse.parse([...rows.map(sessionResponse), ...archivedSessions]
    .sort((a, b) => b.workDate.localeCompare(a.workDate) || b.id - a.id)));
}));
router.post("/service-sessions", massageHandler(async (req, res) => {
  res.status(201).json(CreateServiceSessionResponse.parse(await saveSession(parseInput(CreateServiceSessionBody, req.body), undefined, mutationScope(res.locals.facilityAuth))));
}));
router.patch("/service-sessions/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateServiceSessionParams, req.params);
  res.json(UpdateServiceSessionResponse.parse(await saveSession(parseInput(UpdateServiceSessionBody, req.body), id, mutationScope(res.locals.facilityAuth))));
}));
router.delete("/service-sessions/:id", massageHandler(async (req, res) => {
  await deleteSession(parseInput(DeleteServiceSessionParams, req.params).id, mutationScope(res.locals.facilityAuth));
  res.sendStatus(204);
}));
router.get("/massage-summary", massageHandler(async (req, res) => {
  const { month, date } = parseInput(GetMassageSummaryQueryParams, req.query);
  res.set("Cache-Control", "private, no-store");
  res.json(GetMassageSummaryResponse.parse(await getFacilityRevenue(month, date)));
}));
router.get("/member-payroll", massageHandler(async (req, res) => {
  const { memberId, month } = parseInput(GetMemberPayrollQueryParams, req.query);
  const { start, end } = retainedMonthBounds(month);
  const [member] = await listMembersForPeriod(month, memberId);
  if (!member) throw new MassageError(404, "Không tìm thấy nhân viên.");
  const [row] = await db.select({
    minutes: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}), 0)`,
    salary: sql<number>`coalesce(sum(${serviceSessionsTable.earnings}), 0)`,
  }).from(serviceSessionsTable).where(and(eq(serviceSessionsTable.memberId, memberId),
    gte(serviceSessionsTable.workDate, start), lt(serviceSessionsTable.workDate, end)));
  res.json(GetMemberPayrollResponse.parse({
    month, member,
    totalMinutes: Number(row.minutes), totalSalary: Number(row.salary),
  }));
}));
export default router;
