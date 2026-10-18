import { createHash } from "node:crypto";
import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db, personalServicesTable as services, personalSessionsTable as sessions,
  serviceSessionsTable as visits, treatmentCardsTable as cards } from "@workspace/db";
import type { PersonalComparisonVisit, PersonalDiscrepancy, PersonalSyncInput } from "@workspace/api-zod";
import { listMembersForPeriod } from "./employee-history";
import { MassageError, retainedDate, retainedMonthBounds } from "./massage";
import { lockPersonal, personalSettings, refreshFacilityServices, type PersonalTx } from "./personal-data";

type Visit = PersonalComparisonVisit;
const normalize = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
const groupKey = (v: Visit) => JSON.stringify([v.workDate, normalize(v.serviceName)]);

/** Compare total hours per service and date; return the full rows behind each differing total. */
export function comparePersonalVisits(personal: Visit[], reference: Visit[]): PersonalDiscrepancy[] {
  const keys = new Set([...personal, ...reference].map(groupKey));
  const result: PersonalDiscrepancy[] = [];
  for (const key of keys) {
    const left = personal.filter((v) => groupKey(v) === key);
    const right = reference.filter((v) => groupKey(v) === key);
    const personalMinutes = left.reduce((sum, visit) => sum + visit.minutes, 0);
    const referenceMinutes = right.reduce((sum, visit) => sum + visit.minutes, 0);
    if (personalMinutes === referenceMinutes) continue;
    result.push({ reason: "Tổng thời lượng dịch vụ chưa khớp", personal: left, reference: right });
  }
  return result.sort((a, b) => {
    const left = a.personal[0] ?? a.reference[0];
    const right = b.personal[0] ?? b.reference[0];
    return left.workDate.localeCompare(right.workDate) || normalize(left.serviceName).localeCompare(normalize(right.serviceName), "vi");
  });
}
async function comparisonSnapshot(tx: PersonalTx, userId: string, memberId: number, month: string, date: string) {
  const { start, end } = retainedMonthBounds(month);
  retainedDate(date);
  if (!userId) throw new MassageError(401, "Vui lòng đăng nhập.");
  if (date.slice(0, 7) !== month) throw new MassageError(400, "Ngày cần nằm trong tháng đã chọn.");
  const [member] = await listMembersForPeriod(month, memberId);
  if (!member) throw new MassageError(404, "Không có nhân viên này trong tháng đã chọn.");
  const personal = await tx.select().from(sessions).where(and(eq(sessions.userId, userId),
    gte(sessions.workDate, start), lt(sessions.workDate, end))).orderBy(asc(sessions.id));
  const reference = await tx.select().from(visits).where(and(eq(visits.memberId, memberId),
    gte(visits.workDate, start), lt(visits.workDate, end),
    sql`(${visits.cardId} is null or exists (
      select 1 from ${cards} where ${cards.id} = ${visits.cardId} and ${cards.deletedAt} is null
    ))`)).orderBy(asc(visits.id));
  const personalVisits: Visit[] = personal.map((s) => ({ id: s.id, workDate: s.workDate, serviceName: s.serviceName,
    customerName: s.customerName, minutes: s.minutes, hourlyRate: s.hourlyRate, earnings: s.earnings, note: s.note }));
  const referenceVisits: Visit[] = reference.map((s) => ({ id: s.id, workDate: s.workDate, serviceName: s.serviceType,
    customerName: s.customerName, minutes: s.minutes, hourlyRate: s.hourlyRate, earnings: s.earnings, note: s.note }));
  const total = (rows: Visit[], day?: string) => rows.reduce((sum, v) => sum + (!day || v.workDate === day ? v.earnings : 0), 0);
  const revision = (day?: string) => createHash("sha256").update(JSON.stringify([
    userId, memberId, month, day ?? "month",
    personal.filter((s) => !day || s.workDate === day),
    reference.filter((s) => !day || s.workDate === day),
  ])).digest("hex");
  const personalDay = total(personalVisits, date), personalMonth = total(personalVisits);
  const referenceDay = total(referenceVisits, date), referenceMonth = total(referenceVisits);
  return { personal, reference, report: {
    memberName: member.name, personalDay, personalMonth, referenceDay, referenceMonth,
    differenceDay: personalDay - referenceDay, differenceMonth: personalMonth - referenceMonth,
    personalVisits, referenceVisits, discrepancies: comparePersonalVisits(personalVisits, referenceVisits),
    revisionDay: revision(date), revisionMonth: revision(),
  } };
}
export async function getPersonalComparison(userId: string, memberId: number, month: string, date: string) {
  return db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    return (await comparisonSnapshot(tx, userId, memberId, month, date)).report;
  }, { isolationLevel: "repeatable read" });
}

/** Destructive only within the selected account AND explicitly confirmed day/month. */
export async function syncPersonalNotebook(userId: string, input: PersonalSyncInput) {
  if (!userId) throw new MassageError(401, "Vui lòng đăng nhập.");
  return db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    const snapshot = await comparisonSnapshot(tx, userId, input.memberId, input.month, input.date);
    const expected = input.scope === "day" ? snapshot.report.revisionDay : snapshot.report.revisionMonth;
    if (input.revision !== expected) throw new MassageError(409, "Dữ liệu đã thay đổi. Hãy tải lại đối chiếu và xác nhận lại trước khi thay thế.");
    const { start, end } = retainedMonthBounds(input.month);
    const predicate = and(eq(sessions.userId, userId), input.scope === "day" ? eq(sessions.workDate, input.date)
      : and(gte(sessions.workDate, start), lt(sessions.workDate, end)));
    const removed = await tx.delete(sessions).where(predicate).returning({ id: sessions.id });
    const source = snapshot.reference.filter((s) => input.scope === "month" || s.workDate === input.date);
    const { useFacilityRates } = await personalSettings(tx, userId);
    if (useFacilityRates) await refreshFacilityServices(tx, userId);
    for (const row of source) {
      let [service] = useFacilityRates && row.serviceTypeId
        ? await tx.select().from(services).where(and(eq(services.userId, userId), eq(services.facilityServiceId, row.serviceTypeId)))
        : await tx.select().from(services).where(and(eq(services.userId, userId), isNull(services.facilityServiceId),
            isNull(services.deletedAt), eq(services.name, row.serviceType), eq(services.hourlyRate, row.hourlyRate))).orderBy(asc(services.id)).limit(1);
      // Removed facility types still get an owned snapshot, without recreating central data.
      if (!service) [service] = await tx.insert(services).values({ userId, name: row.serviceType, hourlyRate: row.hourlyRate }).returning();
      await tx.insert(sessions).values({ userId, serviceId: service.id, sourceSessionId: row.id,
        serviceName: row.serviceType, customerName: row.customerName, workDate: row.workDate,
        minutes: row.minutes, hourlyRate: row.hourlyRate, earnings: row.earnings, note: row.note });
    }
    return { removed: removed.length, imported: source.length };
  }, { isolationLevel: "repeatable read" });
}
