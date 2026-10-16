import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db, personalServicesTable as services, personalSessionsTable as sessions,
  serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import type { PersonalServiceInput, PersonalSessionInput } from "@workspace/api-zod";
import { listMembersForPeriod } from "./employee-history";
import { MassageError, monthBounds, validDate } from "./massage";

const owned = (userId: string) => {
  if (!userId) throw new MassageError(401, "Vui lòng đăng nhập.");
  return userId;
};
const serviceResult = (row: typeof services.$inferSelect) => ({ id: row.id, name: row.name, hourlyRate: row.hourlyRate });
const sessionResult = ({ userId: _userId, ...row }: typeof sessions.$inferSelect) => ({ ...row, createdAt: row.createdAt.toISOString() });
const missing = () => new MassageError(404, "Không tìm thấy dữ liệu trong sổ cá nhân.");

function period(month: string, date: string) {
  const bounds = monthBounds(month);
  validDate(date);
  if (date.slice(0, 7) !== month) throw new MassageError(400, "Ngày cần nằm trong tháng đã chọn.");
  return bounds;
}
function rateValues(input: PersonalServiceInput) {
  const name = input.name.trim();
  if (!name || name.length > 120 || !Number.isInteger(input.hourlyRate) || input.hourlyRate < 0 || input.hourlyRate > 100000000) {
    throw new MassageError(400, "Tên dịch vụ hoặc mức tiền không hợp lệ.");
  }
  return { name, hourlyRate: input.hourlyRate };
}
export async function savePersonalService(userId: string, input: PersonalServiceInput, id?: number) {
  owned(userId);
  const values = rateValues(input);
  const [row] = id
    ? await db.update(services).set(values).where(and(eq(services.id, id), eq(services.userId, userId), isNull(services.deletedAt))).returning()
    : await db.insert(services).values({ ...values, userId }).returning();
  if (!row) throw missing();
  return serviceResult(row);
}
export async function deletePersonalService(userId: string, id: number) {
  const [row] = await db.update(services).set({ deletedAt: new Date() })
    .where(and(eq(services.id, id), eq(services.userId, owned(userId)), isNull(services.deletedAt))).returning({ id: services.id });
  if (!row) throw missing();
}
export async function savePersonalSession(userId: string, input: PersonalSessionInput, id?: number) {
  owned(userId);
  validDate(input.workDate);
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440 || input.note.length > 2000) {
    throw new MassageError(400, "Số phút hoặc ghi chú không hợp lệ.");
  }
  return db.transaction(async (tx) => {
    const [previous] = id ? await tx.select().from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId))).for("update") : [];
    if (id && !previous) throw missing();
    const [service] = await tx.select().from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.userId, userId))).for("share");
    if (!service || (service.deletedAt && previous?.serviceId !== service.id)) throw missing();
    const sameService = previous?.serviceId === service.id;
    const hourlyRate = sameService ? previous.hourlyRate : service.hourlyRate;
    const values = {
      userId, serviceId: service.id, serviceName: sameService ? previous.serviceName : service.name,
      workDate: input.workDate, minutes: input.minutes, hourlyRate,
      earnings: Math.round(input.minutes * hourlyRate / 60), note: input.note.trim(),
    };
    const [row] = previous
      ? await tx.update(sessions).set(values).where(and(eq(sessions.id, previous.id), eq(sessions.userId, userId))).returning()
      : await tx.insert(sessions).values(values).returning();
    return sessionResult(row);
  });
}
export async function deletePersonalSession(userId: string, id: number) {
  const [row] = await db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, owned(userId))))
    .returning({ id: sessions.id });
  if (!row) throw missing();
}
export async function getPersonalNotebook(userId: string, month: string, date: string) {
  owned(userId);
  const { start, end } = period(month, date);
  const [serviceRows, sessionRows, monthRows] = await Promise.all([
    db.select().from(services).where(and(eq(services.userId, userId), isNull(services.deletedAt))).orderBy(asc(services.name)),
    db.select().from(sessions).where(and(eq(sessions.userId, userId), gte(sessions.workDate, start), lt(sessions.workDate, end)))
      .orderBy(desc(sessions.workDate), desc(sessions.id)),
    db.selectDistinct({ month: sql<string>`to_char(${sessions.workDate}, 'YYYY-MM')` }).from(sessions)
      .where(eq(sessions.userId, userId)).orderBy(desc(sql`to_char(${sessions.workDate}, 'YYYY-MM')`)),
  ]);
  return { month, date, services: serviceRows.map(serviceResult), sessions: sessionRows.map(sessionResult),
    totalDay: sessionRows.filter((row) => row.workDate === date).reduce((sum, row) => sum + row.earnings, 0),
    totalMonth: sessionRows.reduce((sum, row) => sum + row.earnings, 0), months: monthRows.map((row) => row.month) };
}
export async function getPersonalComparison(userId: string, memberId: number, month: string, date: string) {
  const { start, end } = period(month, date);
  const [member] = await listMembersForPeriod(month, memberId);
  if (!member) throw new MassageError(404, "Không có nhân viên này trong tháng đã chọn.");
  const [notebook, [reference]] = await Promise.all([
    getPersonalNotebook(userId, month, date),
    db.select({
      totalMonth: sql<number>`coalesce(sum(${serviceSessionsTable.earnings}), 0)`,
      totalDay: sql<number>`coalesce(sum(case when ${serviceSessionsTable.workDate} = ${date} then ${serviceSessionsTable.earnings} else 0 end), 0)`,
    }).from(serviceSessionsTable).where(and(eq(serviceSessionsTable.memberId, memberId),
      gte(serviceSessionsTable.workDate, start), lt(serviceSessionsTable.workDate, end),
      sql`(${serviceSessionsTable.cardId} is null or exists (
        select 1 from ${treatmentCardsTable} where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
          and ${treatmentCardsTable.deletedAt} is null
      ))`)),
  ]);
  const referenceDay = Number(reference.totalDay), referenceMonth = Number(reference.totalMonth);
  return { memberName: member.name, personalDay: notebook.totalDay, personalMonth: notebook.totalMonth,
    referenceDay, referenceMonth, differenceDay: notebook.totalDay - referenceDay,
    differenceMonth: notebook.totalMonth - referenceMonth };
}
