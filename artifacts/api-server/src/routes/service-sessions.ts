import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  cardUsageHistoryTable,
  db,
  isPartitionedStorageEnabled,
  readPartitionedTable,
  serviceSessionsTable,
} from "@workspace/db";
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
  const queryMonthBounds = q.month
    ? (q.cardId ? monthBounds(q.month) : retainedMonthBounds(q.month))
    : undefined;
  if (!q.cardId && !q.date && !q.month) filters.push(gte(serviceSessionsTable.workDate, retentionCutoffDate()));
  if (isPartitionedStorageEnabled()) {
    const [partitionSessions, partitionHistory] = await Promise.all([
      readPartitionedTable("service_sessions"),
      q.cardId ? readPartitionedTable("card_usage_history") : Promise.resolve([]),
    ]);
    const allSessions = partitionSessions as unknown as (typeof serviceSessionsTable.$inferSelect)[];
    const allArchived = partitionHistory as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
    const rows = allSessions.filter((row) =>
      (!q.cardId || row.cardId === q.cardId) &&
      (!q.memberId || row.memberId === q.memberId) &&
      (!q.date || row.workDate === q.date) &&
      (!queryMonthBounds || (row.workDate >= queryMonthBounds.start && row.workDate < queryMonthBounds.end)) &&
      (q.cardId !== undefined || q.date !== undefined || q.month !== undefined || row.workDate >= retentionCutoffDate()) &&
      (q.cardId !== undefined || permissions.allEmployees || permissions.employeeIds.includes(row.memberId ?? -1)),
    );
    const archivedRows = allArchived.filter((row) =>
      (!q.cardId || row.cardId === q.cardId) &&
      (!q.memberId || row.memberId === q.memberId) &&
      (!q.date || row.workDate === q.date) &&
      (!queryMonthBounds || (row.workDate >= queryMonthBounds.start && row.workDate < queryMonthBounds.end)),
    );
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
      createdAt: new Date(row.createdAt).toISOString(),
      archived: true,
    }));
    res.json(ListServiceSessionsResponse.parse([...rows.map(sessionResponse), ...archivedSessions]
      .sort((a, b) => b.workDate.localeCompare(a.workDate) || b.id - a.id)));
    return;
  }
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
  res.status(201).json(CreateServiceSessionResponse.parse(await saveSession(
    parseInput(CreateServiceSessionBody, req.body),
    undefined,
    mutationScope(res.locals.facilityAuth),
    req.get("Idempotency-Key") ?? undefined,
  )));
}));
router.patch("/service-sessions/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateServiceSessionParams, req.params);
  res.json(UpdateServiceSessionResponse.parse(await saveSession(
    parseInput(UpdateServiceSessionBody, req.body),
    id,
    mutationScope(res.locals.facilityAuth),
    req.get("Idempotency-Key") ?? undefined,
  )));
}));
router.delete("/service-sessions/:id", massageHandler(async (req, res) => {
  await deleteSession(
    parseInput(DeleteServiceSessionParams, req.params).id,
    mutationScope(res.locals.facilityAuth),
    req.get("Idempotency-Key") ?? undefined,
  );
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
  if (isPartitionedStorageEnabled()) {
    const sessions = await readPartitionedTable("service_sessions") as unknown as (typeof serviceSessionsTable.$inferSelect)[];
    const relevant = sessions.filter((session) =>
      session.memberId === memberId && session.workDate >= start && session.workDate < end,
    );
    res.json(GetMemberPayrollResponse.parse({
      month,
      member,
      totalMinutes: relevant.reduce((total, session) => total + Number(session.minutes), 0),
      totalSalary: relevant.reduce((total, session) => total + Number(session.earnings), 0),
    }));
    return;
  }
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
