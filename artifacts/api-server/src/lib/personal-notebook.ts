import { and, asc, desc, eq, gte, isNull, isNotNull, lt, sql } from "drizzle-orm";
import { db, personalServicesTable as services, personalSessionsTable as sessions,
  personalSettingsTable } from "@workspace/db";
import type { PersonalServiceInput, PersonalSessionInput } from "@workspace/api-zod";
import { MassageError, retainedDate, retainedMonthBounds } from "./massage";
import { lockPersonal, personalSettings, refreshFacilityServices } from "./personal-data";
import { retentionCutoffDate } from "./retention-window";
export { getPersonalComparison } from "./personal-comparison";

const owned = (userId: string) => {
  if (!userId) throw new MassageError(401, "Vui lòng đăng nhập.");
  return userId;
};
const serviceResult = (row: typeof services.$inferSelect) => ({ id: row.id, name: row.name, hourlyRate: row.hourlyRate, facilityServiceId: row.facilityServiceId });
const sessionResult = ({ userId: _userId, requestId: _requestId, ...row }: typeof sessions.$inferSelect) => ({ ...row, createdAt: row.createdAt.toISOString() });
const missing = () => new MassageError(404, "Không tìm thấy dữ liệu trong sổ cá nhân.");

function period(month: string, date: string) {
  const bounds = retainedMonthBounds(month);
  retainedDate(date);
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
  return db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    if ((await personalSettings(tx, userId)).useFacilityRates) throw new MassageError(409, "Tắt dùng đơn giá cơ sở trước khi sửa dịch vụ riêng.");
    const [row] = id
      ? await tx.update(services).set(values).where(and(eq(services.id, id), eq(services.userId, userId), isNull(services.deletedAt), isNull(services.facilityServiceId))).returning()
      : await tx.insert(services).values({ ...values, userId }).returning();
    if (!row) throw missing();
    return serviceResult(row);
  });
}
export async function deletePersonalService(userId: string, id: number) {
  owned(userId);
  await db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    const [row] = await tx.update(services).set({ deletedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.userId, userId), isNull(services.deletedAt), isNull(services.facilityServiceId))).returning({ id: services.id });
    if (!row) throw missing();
  });
}
export async function savePersonalSession(userId: string, input: PersonalSessionInput, id?: number) {
  owned(userId);
  retainedDate(input.workDate);
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440 || input.note.length > 2000) {
    throw new MassageError(400, "Số phút hoặc ghi chú không hợp lệ.");
  }
  return db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    if (!id && input.requestId) {
      const [duplicate] = await tx.select().from(sessions).where(and(eq(sessions.userId, userId), eq(sessions.requestId, input.requestId)));
      if (duplicate) return sessionResult(duplicate);
    }
    if ((input.customerName?.trim().length ?? 0) > 160) throw new MassageError(400, "Tên khách quá dài.");
    const { useFacilityRates } = await personalSettings(tx, userId);
    if (useFacilityRates) await refreshFacilityServices(tx, userId);
    const [previous] = id ? await tx.select().from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId))).for("update") : [];
    if (id && !previous) throw missing();
    const [service] = await tx.select().from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.userId, userId))).for("share");
    if (!service || (service.deletedAt && previous?.serviceId !== service.id)) throw missing();
    const sameService = previous?.serviceId === service.id;
    if (!sameService && useFacilityRates && !service.facilityServiceId) throw new MassageError(409, "Hãy chọn dịch vụ đang có của cơ sở.");
    const hourlyRate = sameService ? previous.hourlyRate : service.hourlyRate;
    const values = {
      userId, serviceId: service.id, serviceName: sameService ? previous.serviceName : service.name,
      workDate: input.workDate, minutes: input.minutes, hourlyRate,
      earnings: Math.round(input.minutes * hourlyRate / 60), note: input.note.trim(),
      customerName: input.customerName?.trim() ?? "",
      ...(!previous ? { requestId: input.requestId ?? null } : {}),
    };
    const [row] = previous
      ? await tx.update(sessions).set(values).where(and(eq(sessions.id, previous.id), eq(sessions.userId, userId))).returning()
      : await tx.insert(sessions).values(values).returning();
    return sessionResult(row);
  });
}
export async function deletePersonalSession(userId: string, id: number) {
  owned(userId);
  await db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    const [row] = await tx.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, userId))).returning({ id: sessions.id });
    if (!row) throw missing();
  });
}
export async function getPersonalNotebook(userId: string, month: string, date: string) {
  owned(userId);
  const { start, end } = period(month, date);
  return db.transaction(async (tx) => {
  await lockPersonal(tx, userId);
  const { useFacilityRates } = await personalSettings(tx, userId);
  if (useFacilityRates) await refreshFacilityServices(tx, userId);
  const serviceRows = await tx.select().from(services).where(and(eq(services.userId, userId), isNull(services.deletedAt),
    useFacilityRates ? isNotNull(services.facilityServiceId) : isNull(services.facilityServiceId))).orderBy(asc(services.name));
  const sessionRows = await tx.select().from(sessions).where(and(eq(sessions.userId, userId),
    gte(sessions.workDate, start), lt(sessions.workDate, end))).orderBy(desc(sessions.workDate), desc(sessions.id));
  const monthRows = await tx.selectDistinct({ month: sql<string>`to_char(${sessions.workDate}, 'YYYY-MM')` }).from(sessions)
    .where(and(eq(sessions.userId, userId), gte(sessions.workDate, retentionCutoffDate())))
    .orderBy(desc(sql`to_char(${sessions.workDate}, 'YYYY-MM')`));
  return { month, date, useFacilityRates, services: serviceRows.map(serviceResult), sessions: sessionRows.map(sessionResult),
    totalDay: sessionRows.filter((row) => row.workDate === date).reduce((sum, row) => sum + row.earnings, 0),
    totalMonth: sessionRows.reduce((sum, row) => sum + row.earnings, 0), months: monthRows.map((row) => row.month) };
  });
}

export async function updatePersonalSettings(userId: string, useFacilityRates: boolean) {
  owned(userId);
  return db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    await tx.insert(personalSettingsTable).values({ userId, useFacilityRates })
      .onConflictDoUpdate({ target: personalSettingsTable.userId, set: { useFacilityRates } });
    if (useFacilityRates) await refreshFacilityServices(tx, userId);
    return { useFacilityRates };
  });
}
