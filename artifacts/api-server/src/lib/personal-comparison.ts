import { createHash } from "node:crypto";
import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db, isPartitionedStorageEnabled, personalServicesTable as services, personalSessionsTable as sessions,
  withPartitionWriteMutex,
  readPartitionedTable, serviceSessionsTable as visits, treatmentCardsTable as cards } from "@workspace/db";
import type { PersonalComparisonVisit, PersonalDiscrepancy, PersonalSyncInput } from "@workspace/api-zod";
import { listMembersForPeriod } from "./employee-history";
import { MassageError, retainedDate, retainedMonthBounds } from "./massage";
import { lockPersonal, personalSettings, refreshFacilityServices, type PersonalTx } from "./personal-data";
import { commitPartitionedMutations, deleteMutation, operationIdFromRequest, upsertMutation } from "./partitioned-mutations";

type Visit = PersonalComparisonVisit;
const personalLock = (userId: string) =>
  `personal:${createHash("sha256").update(userId).digest("hex").slice(0, 48)}`;
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
  if (isPartitionedStorageEnabled()) {
    return (await partitionedComparisonSnapshot(userId, memberId, month, date)).report;
  }
  return db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    return (await comparisonSnapshot(tx, userId, memberId, month, date)).report;
  }, { isolationLevel: "repeatable read" });
}

/** Destructive only within the selected account AND explicitly confirmed day/month. */
export async function syncPersonalNotebook(userId: string, input: PersonalSyncInput, operationId?: string) {
  if (!userId) throw new MassageError(401, "Vui lòng đăng nhập.");
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi đồng bộ sổ cá nhân.");
    return withPartitionWriteMutex(personalLock(userId), async () => {
    const snapshot = await partitionedComparisonSnapshot(userId, input.memberId, input.month, input.date);
    const expectedRevision = input.scope === "day" ? snapshot.report.revisionDay : snapshot.report.revisionMonth;
    if (input.revision !== expectedRevision) {
      throw new MassageError(409, "Dữ liệu đã thay đổi. Hãy tải lại đối chiếu và xác nhận lại trước khi thay thế.");
    }
    const { start, end } = retainedMonthBounds(input.month);
    const oldRows = snapshot.personal.filter((row) =>
      input.scope === "day" ? row.workDate === input.date : row.workDate >= start && row.workDate < end,
    );
    const sourceRows = snapshot.reference.filter((row) =>
      input.scope === "day" ? row.workDate === input.date : row.workDate >= start && row.workDate < end,
    );
    const { services: serviceRows, settings } = await personalPartitionedSnapshot(userId);
    const useFacilityRates = settings.find((row) => row.userId === userId)?.useFacilityRates ?? false;
    const relevantServices = serviceRows.filter((row) => row.userId === userId);
    const newlyNeeded = new Map<string, { name: string; hourlyRate: number; facilityServiceId: number | null }>();
    const resolveServiceKey = (row: typeof snapshot.reference[number]) => {
      const facilityId = useFacilityRates ? row.serviceTypeId : null;
      const candidate = relevantServices.find((service) => service.deletedAt === null &&
        (facilityId !== null
          ? service.facilityServiceId === facilityId
          : service.facilityServiceId === null && service.name === row.serviceType && service.hourlyRate === row.hourlyRate));
      if (candidate) return `existing:${candidate.id}`;
      const key = facilityId !== null
        ? `facility:${facilityId}`
        : `custom:${JSON.stringify([row.serviceType, row.hourlyRate])}`;
      newlyNeeded.set(key, { name: row.serviceType, hourlyRate: row.hourlyRate, facilityServiceId: facilityId });
      return key;
    };
    const serviceKeys = sourceRows.map(resolveServiceKey);
    const operationIdValue = operationIdFromRequest(operationId, "đồng bộ sổ cá nhân");
    const needsCount = newlyNeeded.size;
    const expectedEventCount = oldRows.length + sourceRows.length + needsCount;
    if (expectedEventCount === 0) return { removed: 0, imported: 0 };
    const reserveCounts: Record<string, number> = {
      personal_services: needsCount,
      personal_sessions: sourceRows.length,
    };
    await commitPartitionedMutations({
      operationId: operationIdValue,
      lockName: personalLock(userId),
      action: "personal-sync.replace",
      request: { userId, input },
      expectedEventCount,
      idAllocations: reserveCounts,
      alreadyLocked: true,
      build: (operation) => {
        const mutations = oldRows.map((row) => deleteMutation("personal_sessions", row.id));
        const allocatedServices = operation.allocatedIds.personal_services ?? [];
        const allocatedSessions = operation.allocatedIds.personal_sessions ?? [];
        const serviceIdByKey = new Map<string, number>();
        for (const key of serviceKeys) {
          if (key.startsWith("existing:")) serviceIdByKey.set(key, Number(key.slice("existing:".length)));
        }
        let serviceIndex = 0;
        for (const [key, service] of newlyNeeded) {
          const id = allocatedServices[serviceIndex++];
          if (!id) throw new MassageError(503, "Không cấp được mã dịch vụ khi đồng bộ.");
          serviceIdByKey.set(key, id);
          mutations.push(upsertMutation("personal_services", id, {
            id, userId, name: service.name, hourlyRate: service.hourlyRate,
            createdAt: new Date(), deletedAt: null, facilityServiceId: service.facilityServiceId,
          }));
        }
        sourceRows.forEach((row, index) => {
          const id = allocatedSessions[index];
          const serviceId = serviceIdByKey.get(serviceKeys[index]!);
          if (!id || !serviceId) throw new MassageError(503, "Không cấp được mã ca khi đồng bộ.");
          mutations.push(upsertMutation("personal_sessions", id, {
            id, userId, serviceId, sourceSessionId: row.id, serviceName: row.serviceType,
            customerName: row.customerName, workDate: row.workDate, minutes: row.minutes,
            hourlyRate: row.hourlyRate, earnings: row.earnings, note: row.note,
            requestId: null, createdAt: new Date(),
          }));
        });
        return mutations;
      },
    });
    return { removed: oldRows.length, imported: sourceRows.length };
    });
  }
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

async function personalPartitionedSnapshot(userId: string) {
  const [servicesRaw, sessionsRaw, settingsRaw] = await Promise.all([
    readPartitionedTable("personal_services", { userId }),
    readPartitionedTable("personal_sessions", { userId }),
    readPartitionedTable("personal_settings", { userId }),
  ]);
  return {
    services: servicesRaw as unknown as (typeof services.$inferSelect)[],
    sessions: sessionsRaw as unknown as (typeof sessions.$inferSelect)[],
    settings: settingsRaw as unknown as { userId: string; useFacilityRates: boolean }[],
  };
}

async function partitionedComparisonSnapshot(userId: string, memberId: number, month: string, date: string) {
  const { start, end } = retainedMonthBounds(month);
  retainedDate(date);
  if (date.slice(0, 7) !== month) throw new MassageError(400, "Ngày cần nằm trong tháng đã chọn.");
  const [member] = await listMembersForPeriod(month, memberId);
  if (!member) throw new MassageError(404, "Không có nhân viên này trong tháng đã chọn.");
  const [personalSnapshot, visitsRaw, cardsRaw] = await Promise.all([
    personalPartitionedSnapshot(userId),
    readPartitionedTable("service_sessions"),
    readPartitionedTable("treatment_cards"),
  ]);
  const personal = personalSnapshot.sessions.filter((row) =>
    row.userId === userId && row.workDate >= start && row.workDate < end,
  ).sort((a, b) => a.id - b.id);
  const activeCardIds = new Set(
    (cardsRaw as unknown as (typeof cards.$inferSelect)[])
      .filter((card) => card.deletedAt === null)
      .map((card) => card.id),
  );
  const reference = (visitsRaw as unknown as (typeof visits.$inferSelect)[])
    .filter((row) => row.memberId === memberId && row.workDate >= start && row.workDate < end &&
      (row.cardId === null || activeCardIds.has(row.cardId)))
    .sort((a, b) => a.id - b.id);
  const personalVisits: Visit[] = personal.map((row) => ({
    id: row.id, workDate: row.workDate, serviceName: row.serviceName, customerName: row.customerName,
    minutes: row.minutes, hourlyRate: row.hourlyRate, earnings: row.earnings, note: row.note,
  }));
  const referenceVisits: Visit[] = reference.map((row) => ({
    id: row.id, workDate: row.workDate, serviceName: row.serviceType, customerName: row.customerName,
    minutes: row.minutes, hourlyRate: row.hourlyRate, earnings: row.earnings, note: row.note,
  }));
  const total = (rows: Visit[], day?: string) => rows.reduce((sum, row) => sum + (!day || row.workDate === day ? row.earnings : 0), 0);
  const revision = (day?: string) => createHash("sha256").update(JSON.stringify([
    userId, memberId, month, day ?? "month",
    personal.filter((row) => !day || row.workDate === day),
    reference.filter((row) => !day || row.workDate === day),
  ])).digest("hex");
  const personalDay = total(personalVisits, date);
  const personalMonth = total(personalVisits);
  const referenceDay = total(referenceVisits, date);
  const referenceMonth = total(referenceVisits);
  return {
    personal,
    reference,
    report: {
      memberName: member.name, personalDay, personalMonth, referenceDay, referenceMonth,
      differenceDay: personalDay - referenceDay, differenceMonth: personalMonth - referenceMonth,
      personalVisits, referenceVisits, discrepancies: comparePersonalVisits(personalVisits, referenceVisits),
      revisionDay: revision(date), revisionMonth: revision(),
    },
  };
}
