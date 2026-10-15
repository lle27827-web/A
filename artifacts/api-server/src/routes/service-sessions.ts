import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, membersTable, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import {
  CreateServiceSessionBody, CreateServiceSessionResponse, DeleteServiceSessionParams,
  GetMassageSummaryQueryParams, GetMassageSummaryResponse, GetMemberPayrollQueryParams, GetMemberPayrollResponse,
  ListServiceSessionsQueryParams, ListServiceSessionsResponse,
  UpdateServiceSessionBody, UpdateServiceSessionParams, UpdateServiceSessionResponse,
} from "@workspace/api-zod";
import { deleteSession, MassageError, monthBounds, saveSession, sessionResponse, validDate } from "../lib/massage";
import { massageHandler, parseInput } from "./massage-errors";
import { getFacilityRevenue } from "../lib/facility-revenue";

const router: IRouter = Router();
router.get("/service-sessions", massageHandler(async (req, res) => {
  const q = parseInput(ListServiceSessionsQueryParams, req.query);
  const filters = [];
  if (q.memberId) filters.push(eq(serviceSessionsTable.memberId, q.memberId));
  if (q.cardId) filters.push(eq(serviceSessionsTable.cardId, q.cardId));
  if (q.date) filters.push(eq(serviceSessionsTable.workDate, validDate(q.date)));
  if (q.month) {
    const { start, end } = monthBounds(q.month);
    filters.push(gte(serviceSessionsTable.workDate, start), lt(serviceSessionsTable.workDate, end));
  }
  const visibleVisits = sql`(${serviceSessionsTable.cardId} is null or exists (
    select 1 from ${treatmentCardsTable} where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
      and ${treatmentCardsTable.deletedAt} is null
  ))`;
  const rows = await db.select().from(serviceSessionsTable).where(and(...filters, visibleVisits))
    .orderBy(desc(serviceSessionsTable.workDate), desc(serviceSessionsTable.id));
  res.json(ListServiceSessionsResponse.parse(rows.map(sessionResponse)));
}));
router.post("/service-sessions", massageHandler(async (req, res) => {
  res.status(201).json(CreateServiceSessionResponse.parse(await saveSession(parseInput(CreateServiceSessionBody, req.body))));
}));
router.patch("/service-sessions/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateServiceSessionParams, req.params);
  res.json(UpdateServiceSessionResponse.parse(await saveSession(parseInput(UpdateServiceSessionBody, req.body), id)));
}));
router.delete("/service-sessions/:id", massageHandler(async (req, res) => {
  await deleteSession(parseInput(DeleteServiceSessionParams, req.params).id);
  res.sendStatus(204);
}));
router.get("/massage-summary", massageHandler(async (req, res) => {
  const { month, date } = parseInput(GetMassageSummaryQueryParams, req.query);
  res.set("Cache-Control", "private, no-store");
  res.json(GetMassageSummaryResponse.parse(await getFacilityRevenue(month, date)));
}));
router.get("/member-payroll", massageHandler(async (req, res) => {
  const { memberId, month } = parseInput(GetMemberPayrollQueryParams, req.query);
  const { start, end } = monthBounds(month);
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, memberId));
  if (!member) throw new MassageError(404, "Không tìm thấy nhân viên.");
  const [row] = await db.select({
    minutes: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}), 0)`,
    salary: sql<number>`coalesce(sum(${serviceSessionsTable.earnings}), 0)`,
  }).from(serviceSessionsTable).where(and(eq(serviceSessionsTable.memberId, memberId),
    gte(serviceSessionsTable.workDate, start), lt(serviceSessionsTable.workDate, end),
    sql`(${serviceSessionsTable.cardId} is null or exists (
      select 1 from ${treatmentCardsTable} where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
        and ${treatmentCardsTable.deletedAt} is null
    ))`));
  res.json(GetMemberPayrollResponse.parse({
    month, member: { ...member, createdAt: member.createdAt.toISOString() },
    totalMinutes: Number(row.minutes), totalSalary: Number(row.salary),
  }));
}));
export default router;
