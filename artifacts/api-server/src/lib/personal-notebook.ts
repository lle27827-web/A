import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, isNotNull, lt, sql } from "drizzle-orm";
import { db, isPartitionedStorageEnabled, personalServicesTable as services, personalSessionsTable as sessions,
  personalSettingsTable, facilityNightSettingsTable, readPartitionedTable } from "@workspace/db";
import { withPartitionWriteMutex } from "@workspace/db";
import type { PersonalServiceInput, PersonalSessionInput } from "@workspace/api-zod";
import { MassageError, retainedDate, retainedMonthBounds } from "./massage";
import { lockPersonal, personalSettings, refreshFacilityServices } from "./personal-data";
import { retentionCutoffDate } from "./retention-window";
import { resolvePersonalShiftPricing } from "./personal-night-pricing";
import { commitPartitionedMutations, deleteMutation, operationIdFromRequest, upsertMutation } from "./partitioned-mutations";
export { getPersonalComparison } from "./personal-comparison";

const owned = (userId: string) => {
  if (!userId) throw new MassageError(401, "Vui lòng đăng nhập.");
  return userId;
};
const serviceResult = (row: typeof services.$inferSelect) => ({
  id: row.id, name: row.name, hourlyRate: row.hourlyRate,
  nightHourlyRate: row.nightHourlyRate ?? null, facilityServiceId: row.facilityServiceId,
});
const sessionResult = ({ userId: _userId, requestId: _requestId, ...row }: typeof sessions.$inferSelect) => ({
  ...row,
  isNightShift: row.isNightShift === true,
  createdAt: row.createdAt.toISOString(),
});
const missing = () => new MassageError(404, "Không tìm thấy dữ liệu trong sổ cá nhân.");
const personalLock = (userId: string) =>
  `personal:${createHash("sha256").update(userId).digest("hex").slice(0, 48)}`;
const operation = (id?: string, label?: string) => operationIdFromRequest(id, label ?? "sổ cá nhân");
const withPersonalPartitionWrite = <T>(userId: string, callback: () => Promise<T>) =>
  withPartitionWriteMutex(personalLock(userId), callback);
async function partitionedPersonalSnapshot(userId: string, businessId?: string) {
  const [servicesRaw, sessionsRaw, settingsRaw, nightSettingsRaw] = await Promise.all([
    readPartitionedTable("personal_services", { userId }),
    readPartitionedTable("personal_sessions", { userId }),
    readPartitionedTable("personal_settings", { userId }),
    businessId ? readPartitionedTable("facility_night_settings", { businessId }) : Promise.resolve([]),
  ]);
  return {
    services: servicesRaw as unknown as (typeof services.$inferSelect)[],
    sessions: sessionsRaw as unknown as (typeof sessions.$inferSelect)[],
    settings: settingsRaw as unknown as (typeof personalSettingsTable.$inferSelect)[],
    nightSettings: nightSettingsRaw as unknown as (typeof facilityNightSettingsTable.$inferSelect)[],
  };
}

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
export async function savePersonalService(userId: string, input: PersonalServiceInput, id?: number, operationId?: string) {
  owned(userId);
  const values = rateValues(input);
  if (isPartitionedStorageEnabled()) {
    return withPersonalPartitionWrite(userId, async () => {
    const { services: serviceRows, settings } = await partitionedPersonalSnapshot(userId);
    if (settings.find((row) => row.userId === userId)?.useFacilityRates) {
      throw new MassageError(409, "Tắt dùng đơn giá cơ sở trước khi sửa dịch vụ riêng.");
    }
    const old = id ? serviceRows.find((row) => row.id === id && row.userId === userId &&
      row.deletedAt === null && row.facilityServiceId === null) : undefined;
    if (id && !old) throw missing();
    const now = new Date();
    const requestId = operation(operationId, "dịch vụ cá nhân");
    const reserved = await commitPartitionedMutations({
      operationId: requestId,
      lockName: personalLock(userId),
      action: id ? "personal-service.update" : "personal-service.create",
      request: { userId, id: id ?? null, values },
      expectedEventCount: 1,
      idAllocations: id ? {} : { personal_services: 1 },
      alreadyLocked: true,
      build: (op) => {
        const serviceId = id ?? op.allocatedIds.personal_services?.[0];
        if (!serviceId) throw new MassageError(503, "Không cấp được mã dịch vụ cá nhân.");
        return [upsertMutation("personal_services", serviceId, {
          id: serviceId, userId, ...values, createdAt: old?.createdAt ?? now,
          nightHourlyRate: null, deletedAt: null, facilityServiceId: null,
        })];
      },
    });
    const serviceId = id ?? reserved.allocatedIds.personal_services?.[0];
    const row = (await readPartitionedTable("personal_services", { userId }) as unknown as (typeof services.$inferSelect)[])
      .find((item) => item.id === serviceId && item.userId === userId);
    if (!row) throw new MassageError(503, "Không tải lại được dịch vụ cá nhân.");
    return serviceResult(row);
    });
  }
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
export async function deletePersonalService(userId: string, id: number, operationId?: string) {
  owned(userId);
  if (isPartitionedStorageEnabled()) {
    return withPersonalPartitionWrite(userId, async () => {
    const { services: serviceRows } = await partitionedPersonalSnapshot(userId);
    const row = serviceRows.find((item) => item.id === id && item.userId === userId &&
      item.deletedAt === null && item.facilityServiceId === null);
    if (!row) throw missing();
    await commitPartitionedMutations({
      operationId: operation(operationId, "xóa dịch vụ cá nhân"),
      lockName: personalLock(userId),
      action: "personal-service.delete",
      request: { userId, id },
      expectedEventCount: 1,
      alreadyLocked: true,
      build: () => [upsertMutation("personal_services", id, { ...row, deletedAt: new Date() })],
    });
    return;
    });
  }
  await db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    const [row] = await tx.update(services).set({ deletedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.userId, userId), isNull(services.deletedAt), isNull(services.facilityServiceId))).returning({ id: services.id });
    if (!row) throw missing();
  });
}
export async function savePersonalSession(
  userId: string,
  input: PersonalSessionInput,
  id?: number,
  operationId?: string,
  businessId?: string,
) {
  owned(userId);
  retainedDate(input.workDate);
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440 || input.note.length > 2000) {
    throw new MassageError(400, "Số phút hoặc ghi chú không hợp lệ.");
  }
  if (isPartitionedStorageEnabled()) {
    return withPersonalPartitionWrite(userId, async () => {
    if ((input.customerName?.trim().length ?? 0) > 160) throw new MassageError(400, "Tên khách quá dài.");
    const { services: serviceRows, sessions: sessionRows, settings, nightSettings } = await partitionedPersonalSnapshot(userId, businessId);
    const previous = id ? sessionRows.find((row) => row.id === id && row.userId === userId) : undefined;
    if (id && !previous) throw missing();
    if (!id && input.requestId) {
      const duplicate = sessionRows.find((row) => row.userId === userId && row.requestId === input.requestId);
      if (duplicate) return sessionResult(duplicate);
    }
    const useFacilityRates = settings.find((row) => row.userId === userId)?.useFacilityRates ?? false;
    if (useFacilityRates && !businessId) throw new MassageError(403, "Chọn cơ sở đã được cấp quyền để dùng đơn giá cơ sở.");
    const service = serviceRows.find((row) => row.id === input.serviceId && row.userId === userId);
    if (!service || (service.deletedAt && previous?.serviceId !== service.id)) throw missing();
    const sameService = previous?.serviceId === service.id;
    if (!sameService && useFacilityRates && !service.facilityServiceId) {
      throw new MassageError(409, "Hãy chọn dịch vụ đang có của cơ sở.");
    }
    const now = new Date();
    const nightConfig = nightSettings.find((row) => row.id === 1);
    const pricing = resolvePersonalShiftPricing({
      now, previous, serviceId: service.id, serviceHourlyRate: service.hourlyRate,
      serviceNightHourlyRate: service.nightHourlyRate, facilityServiceId: service.facilityServiceId,
      useFacilityRates, nightConfig,
    });
    if (pricing.useNightRate && !pricing.sameService && !service.nightHourlyRate) {
      throw new MassageError(400, `Hãy cài tiền công ca đêm cho dịch vụ ${service.name} trong Cài đặt.`);
    }
    const hourlyRate = pricing.hourlyRate;
    const values = {
      id: id ?? 0,
      userId,
      serviceId: service.id,
      serviceName: sameService ? previous.serviceName : service.name,
      workDate: input.workDate,
      minutes: input.minutes,
      hourlyRate,
      earnings: Math.round(input.minutes * hourlyRate / 60),
      isNightShift: pricing.isNightShift,
      note: input.note.trim(),
      customerName: input.customerName?.trim() ?? "",
      requestId: previous?.requestId ?? input.requestId ?? null,
      sourceSessionId: previous?.sourceSessionId ?? null,
      createdAt: previous?.createdAt ?? now,
    };
    const reserved = await commitPartitionedMutations({
      operationId: operation(operationId, "ca cá nhân"),
      lockName: personalLock(userId),
      action: id ? "personal-session.update" : "personal-session.create",
      request: { userId, id: id ?? null, input },
      expectedEventCount: 1,
      idAllocations: id ? {} : { personal_sessions: 1 },
      alreadyLocked: true,
      build: (op) => {
        const sessionId = id ?? op.allocatedIds.personal_sessions?.[0];
        if (!sessionId) throw new MassageError(503, "Không cấp được mã ca cá nhân.");
        return [upsertMutation("personal_sessions", sessionId, { ...values, id: sessionId })];
      },
    });
    const sessionId = id ?? reserved.allocatedIds.personal_sessions?.[0];
    const row = (await readPartitionedTable("personal_sessions", { userId }) as unknown as (typeof sessions.$inferSelect)[])
      .find((item) => item.id === sessionId && item.userId === userId);
    if (!row) throw new MassageError(503, "Không tải lại được ca cá nhân.");
    return sessionResult(row);
    });
  }
  return db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    if (!id && input.requestId) {
      const [duplicate] = await tx.select().from(sessions).where(and(eq(sessions.userId, userId), eq(sessions.requestId, input.requestId)));
      if (duplicate) return sessionResult(duplicate);
    }
    if ((input.customerName?.trim().length ?? 0) > 160) throw new MassageError(400, "Tên khách quá dài.");
    const { useFacilityRates } = await personalSettings(tx, userId);
    if (useFacilityRates) {
      if (!businessId) throw new MassageError(403, "Chọn cơ sở đã được cấp quyền để dùng đơn giá cơ sở.");
      await refreshFacilityServices(tx, userId, businessId);
    }
    const [previous] = id ? await tx.select().from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId))).for("update") : [];
    if (id && !previous) throw missing();
    const [service] = await tx.select().from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.userId, userId))).for("share");
    if (!service || (service.deletedAt && previous?.serviceId !== service.id)) throw missing();
    const sameService = previous?.serviceId === service.id;
    if (!sameService && useFacilityRates && !service.facilityServiceId) throw new MassageError(409, "Hãy chọn dịch vụ đang có của cơ sở.");
    const [nightConfig] = businessId ? await tx.select().from(facilityNightSettingsTable)
      .where(and(
        eq(facilityNightSettingsTable.id, 1),
        eq(facilityNightSettingsTable.businessId, businessId),
      )).limit(1) : [];
    const createdAt = previous?.createdAt ?? new Date();
    const pricing = resolvePersonalShiftPricing({
      now: createdAt, previous, serviceId: service.id, serviceHourlyRate: service.hourlyRate,
      serviceNightHourlyRate: service.nightHourlyRate, facilityServiceId: service.facilityServiceId,
      useFacilityRates, nightConfig,
    });
    if (pricing.useNightRate && !pricing.sameService && !service.nightHourlyRate) {
      throw new MassageError(400, `Hãy cài tiền công ca đêm cho dịch vụ ${service.name} trong Cài đặt.`);
    }
    const hourlyRate = pricing.hourlyRate;
    const values = {
      userId, serviceId: service.id, serviceName: sameService ? previous.serviceName : service.name,
      workDate: input.workDate, minutes: input.minutes, hourlyRate,
      earnings: Math.round(input.minutes * hourlyRate / 60), isNightShift: pricing.isNightShift, note: input.note.trim(),
      customerName: input.customerName?.trim() ?? "",
      ...(!previous ? { requestId: input.requestId ?? null } : {}),
    };
    const [row] = previous
      ? await tx.update(sessions).set(values).where(and(eq(sessions.id, previous.id), eq(sessions.userId, userId))).returning()
      : await tx.insert(sessions).values(values).returning();
    return sessionResult(row);
  });
}
export async function deletePersonalSession(userId: string, id: number, operationId?: string) {
  owned(userId);
  if (isPartitionedStorageEnabled()) {
    return withPersonalPartitionWrite(userId, async () => {
    const { sessions: sessionRows } = await partitionedPersonalSnapshot(userId);
    const row = sessionRows.find((item) => item.id === id && item.userId === userId);
    if (!row) throw missing();
    await commitPartitionedMutations({
      operationId: operation(operationId, "xóa ca cá nhân"),
      lockName: personalLock(userId),
      action: "personal-session.delete",
      request: { userId, id },
      expectedEventCount: 1,
      alreadyLocked: true,
      build: () => [deleteMutation("personal_sessions", id)],
    });
    return;
    });
  }
  await db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    const [row] = await tx.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, userId))).returning({ id: sessions.id });
    if (!row) throw missing();
  });
}
export async function getPersonalNotebook(userId: string, month: string, date: string, businessId?: string) {
  owned(userId);
  const { start, end } = period(month, date);
  if (isPartitionedStorageEnabled()) {
  const { services: serviceRows, sessions: sessionRows, settings } = await partitionedPersonalSnapshot(userId, businessId);
    const useFacilityRates = settings.find((row) => row.userId === userId)?.useFacilityRates ?? false;
    const visibleServices = serviceRows.filter((row) => row.userId === userId && row.deletedAt === null &&
      (useFacilityRates ? row.facilityServiceId !== null : row.facilityServiceId === null))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
    const visibleSessions = sessionRows.filter((row) => row.userId === userId &&
      row.workDate >= start && row.workDate < end)
      .sort((a, b) => b.workDate.localeCompare(a.workDate) || b.id - a.id);
    const months = [...new Set(sessionRows.filter((row) => row.userId === userId &&
      row.workDate >= retentionCutoffDate()).map((row) => row.workDate.slice(0, 7)))]
      .sort().reverse();
    return {
      month, date, useFacilityRates, services: visibleServices.map(serviceResult),
      sessions: visibleSessions.map(sessionResult),
      totalDay: visibleSessions.filter((row) => row.workDate === date).reduce((sum, row) => sum + row.earnings, 0),
      totalMonth: visibleSessions.reduce((sum, row) => sum + row.earnings, 0),
      months,
    };
  }
  return db.transaction(async (tx) => {
  await lockPersonal(tx, userId);
  const { useFacilityRates } = await personalSettings(tx, userId);
  if (useFacilityRates && businessId) await refreshFacilityServices(tx, userId, businessId);
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

export async function updatePersonalSettings(
  userId: string,
  useFacilityRates: boolean,
  operationId?: string,
  businessId?: string,
) {
  owned(userId);
  if (useFacilityRates && !businessId) throw new MassageError(403, "Chọn cơ sở đã được cấp quyền để dùng đơn giá cơ sở.");
  if (isPartitionedStorageEnabled()) {
    return withPersonalPartitionWrite(userId, async () => {
    const [snapshot, facilityRaw] = await Promise.all([
      partitionedPersonalSnapshot(userId, businessId),
      useFacilityRates
        ? readPartitionedTable("service_types", { businessId: businessId! })
        : Promise.resolve([]),
    ]);
    const catalog = (facilityRaw as unknown as (typeof import("@workspace/db").serviceTypesTable.$inferSelect)[])
      .map(({ id, name, hourlyRate, nightHourlyRate }) => ({ id, name, hourlyRate, nightHourlyRate }))
      .sort((a, b) => a.id - b.id);
    const ownServices = snapshot.services.filter((row) => row.userId === userId);
    const existingByFacility = new Map(ownServices.filter((row) => row.facilityServiceId !== null)
      .map((row) => [row.facilityServiceId!, row]));
    const missingCatalog = useFacilityRates ? catalog.filter((item) => !existingByFacility.has(item.id)) : [];
    const now = new Date();
    const mutationsCount = 1 + missingCatalog.length +
      (useFacilityRates ? catalog.filter((item) => {
        const row = existingByFacility.get(item.id);
        return row && (row.name !== item.name || row.hourlyRate !== item.hourlyRate ||
          row.nightHourlyRate !== item.nightHourlyRate || row.deletedAt !== null);
      }).length : 0) +
      (useFacilityRates ? ownServices.filter((row) => row.facilityServiceId !== null &&
        !catalog.some((item) => item.id === row.facilityServiceId) && row.deletedAt === null).length : 0);
    const reserved = await commitPartitionedMutations({
      operationId: operation(operationId, "cài đặt sổ cá nhân"),
      lockName: personalLock(userId),
      action: "personal-settings.update",
      request: { userId, useFacilityRates, catalog },
      expectedEventCount: mutationsCount,
      idAllocations: { personal_services: missingCatalog.length },
      alreadyLocked: true,
      build: (op) => {
        const result = [upsertMutation("personal_settings", userId, { userId, useFacilityRates })];
        const allocated = op.allocatedIds.personal_services ?? [];
        let index = 0;
        for (const item of catalog) {
          const current = existingByFacility.get(item.id);
          if (current) {
            if (current.name !== item.name || current.hourlyRate !== item.hourlyRate ||
              current.nightHourlyRate !== item.nightHourlyRate || current.deletedAt !== null) {
              result.push(upsertMutation("personal_services", current.id, {
                ...current, name: item.name, hourlyRate: item.hourlyRate,
                nightHourlyRate: item.nightHourlyRate, deletedAt: null,
              }));
            }
          } else if (useFacilityRates) {
            const serviceId = allocated[index++];
            if (!serviceId) throw new MassageError(503, "Không cấp được mã dịch vụ cá nhân đồng bộ.");
            result.push(upsertMutation("personal_services", serviceId, {
              id: serviceId, userId, name: item.name, hourlyRate: item.hourlyRate,
              nightHourlyRate: item.nightHourlyRate, createdAt: now, deletedAt: null, facilityServiceId: item.id,
            }));
          }
        }
        if (useFacilityRates) {
          for (const current of ownServices) {
            if (current.facilityServiceId !== null && !catalog.some((item) => item.id === current.facilityServiceId) &&
                current.deletedAt === null) {
              result.push(upsertMutation("personal_services", current.id, { ...current, deletedAt: now }));
            }
          }
        }
        return result;
      },
    });
    return { useFacilityRates };
    });
  }
  return db.transaction(async (tx) => {
    await lockPersonal(tx, userId);
    await tx.insert(personalSettingsTable).values({ userId, useFacilityRates })
      .onConflictDoUpdate({ target: personalSettingsTable.userId, set: { useFacilityRates } });
    if (useFacilityRates) await refreshFacilityServices(tx, userId, businessId!);
    return { useFacilityRates };
  });
}
