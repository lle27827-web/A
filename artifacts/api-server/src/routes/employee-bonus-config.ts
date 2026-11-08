import { Router, type IRouter } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db,
  employeeBonusRateKey,
  employeeServiceBonusRatesTable,
  facilityBonusSettingsTable,
  isPartitionedStorageEnabled,
  membersTable,
  readPartitionedTable,
  serviceTypesTable,
  withPartitionWriteMutex,
} from "@workspace/db";
import {
  GetEmployeeBonusConfigResponse,
  UpdateEmployeeBonusConfigBody,
  UpdateEmployeeBonusConfigResponse,
} from "@workspace/api-zod";
import { MassageError, idempotentTransaction } from "../lib/massage";
import { commitPartitionedMutations, deleteMutation, operationIdFromRequest, upsertMutation } from "../lib/partitioned-mutations";
import { currentFacilityBusinessId, requireOwner } from "../lib/owner-auth";
import { massageHandler, parseInput } from "./massage-errors";

const router: IRouter = Router();
const DEFAULT_BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const businessIdFor = currentFacilityBusinessId;
const bonusRateKey = (memberId: number, serviceTypeId: number, businessId: string) =>
  businessId === DEFAULT_BUSINESS_ID
    ? employeeBonusRateKey(memberId, serviceTypeId)
    : `${businessId}:${memberId}:${serviceTypeId}`;

async function readConfig(businessId: string) {
  if (isPartitionedStorageEnabled()) {
    const [membersRaw, servicesRaw, settingsRaw, ratesRaw] = await Promise.all([
      readPartitionedTable("members", { businessId }),
      readPartitionedTable("service_types", { businessId }),
      readPartitionedTable("facility_bonus_settings", { businessId }),
      readPartitionedTable("employee_service_bonus_rates", { businessId }),
    ]);
    const members = membersRaw as unknown as (typeof membersTable.$inferSelect)[];
    const services = servicesRaw as unknown as (typeof serviceTypesTable.$inferSelect)[];
    const settings = settingsRaw as unknown as (typeof facilityBonusSettingsTable.$inferSelect)[];
    const rates = ratesRaw as unknown as (typeof employeeServiceBonusRatesTable.$inferSelect)[];
    const config = settings.find((row) => row.id === 1);
    const activeMemberIds = new Set(members.filter((row) => row.deletedAt === null).map((row) => row.id));
    const serviceIds = new Set(services.map((row) => row.id));
    return {
      enabled: config?.enabled ?? false,
      thresholdMinutes: config?.thresholdMinutes ?? 0,
      members: members.filter((row) => row.deletedAt === null)
        .map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "vi")),
      services: services
        .map(({ id, name, hourlyRate }) => ({ id, name, hourlyRate }))
        .sort((a, b) => a.name.localeCompare(b.name, "vi")),
      rates: rates.filter((row) => activeMemberIds.has(row.memberId) && serviceIds.has(row.serviceTypeId))
        .map(({ memberId, serviceTypeId, hourlyRate }) => ({ memberId, serviceTypeId, hourlyRate })),
    };
  }

  const [members, services, settings, rates] = await Promise.all([
    db.select({ id: membersTable.id, name: membersTable.name }).from(membersTable)
      .where(and(eq(membersTable.businessId, businessId), isNull(membersTable.deletedAt))).orderBy(asc(membersTable.name)),
    db.select({
      id: serviceTypesTable.id, name: serviceTypesTable.name, hourlyRate: serviceTypesTable.hourlyRate,
    }).from(serviceTypesTable).where(eq(serviceTypesTable.businessId, businessId)).orderBy(asc(serviceTypesTable.name)),
    db.select().from(facilityBonusSettingsTable).where(and(
      eq(facilityBonusSettingsTable.businessId, businessId),
      eq(facilityBonusSettingsTable.id, 1),
    )).limit(1),
    db.select({
      memberId: employeeServiceBonusRatesTable.memberId,
      serviceTypeId: employeeServiceBonusRatesTable.serviceTypeId,
      hourlyRate: employeeServiceBonusRatesTable.hourlyRate,
    }).from(employeeServiceBonusRatesTable).where(eq(employeeServiceBonusRatesTable.businessId, businessId)),
  ]);
  return {
    enabled: settings[0]?.enabled ?? false,
    thresholdMinutes: settings[0]?.thresholdMinutes ?? 0,
    members,
    services,
    rates,
  };
}

router.get("/employee-bonus-config", requireOwner, massageHandler(async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(GetEmployeeBonusConfigResponse.parse(await readConfig(businessIdFor(res))));
}));

router.patch("/employee-bonus-config", requireOwner, massageHandler(async (req, res) => {
  const businessId = businessIdFor(res);
  const input = parseInput(UpdateEmployeeBonusConfigBody, req.body);
  const operationId = operationIdFromRequest(req.get("Idempotency-Key"), "lưu cấu hình thưởng tiền công");
  if (input.enabled && input.thresholdMinutes < 1) {
    throw new MassageError(400, "Nhập ngưỡng giờ lớn hơn 0 trước khi bật thưởng tiền công.");
  }
  const uniqueRateKeys = new Set(input.rates?.map(({ memberId, serviceTypeId }) =>
    bonusRateKey(memberId, serviceTypeId, businessId),
  ) ?? []);
  if (uniqueRateKeys.size !== (input.rates?.length ?? 0)) {
    throw new MassageError(400, "Không được lặp cùng một nhân viên và dịch vụ trong bảng giá.");
  }

  if (isPartitionedStorageEnabled()) {
    const saved = await withPartitionWriteMutex("employee-bonus-config", async () => {
      const [membersRaw, servicesRaw] = await Promise.all([
        readPartitionedTable("members", { businessId }),
        readPartitionedTable("service_types", { businessId }),
      ]);
      const members = membersRaw as unknown as (typeof membersTable.$inferSelect)[];
      const services = servicesRaw as unknown as (typeof serviceTypesTable.$inferSelect)[];
      const activeMemberIds = new Set(members.filter((row) => row.deletedAt === null).map((row) => row.id));
      const serviceById = new Map(services.map((row) => [row.id, row]));
      for (const update of input.rates ?? []) {
        if (!activeMemberIds.has(update.memberId)) throw new MassageError(404, "Không tìm thấy nhân viên đang hoạt động.");
        const service = serviceById.get(update.serviceTypeId);
        if (!service) throw new MassageError(404, "Không tìm thấy dịch vụ đang hoạt động.");
        if (update.hourlyRate !== null && update.hourlyRate <= service.hourlyRate) {
          throw new MassageError(400, `Tiền công thưởng của dịch vụ ${service.name} phải cao hơn mức hiện tại.`);
        }
      }
      return commitPartitionedMutations({
        operationId,
        lockName: "employee-bonus-config",
        alreadyLocked: true,
        action: "employee-bonus-config.update",
        request: { ...input, businessId },
        expectedEventCount: 1 + (input.rates?.length ?? 0),
        build: () => [
          upsertMutation("facility_bonus_settings", 1, {
            id: 1,
            businessId,
            enabled: input.enabled,
            thresholdMinutes: input.thresholdMinutes,
            updatedAt: new Date(),
          }),
          ...(input.rates ?? []).map((update) => {
            const key = bonusRateKey(update.memberId, update.serviceTypeId, businessId);
            return update.hourlyRate === null
              ? deleteMutation("employee_service_bonus_rates", key)
              : upsertMutation("employee_service_bonus_rates", key, {
                  id: key,
                  businessId,
                  memberId: update.memberId,
                  serviceTypeId: update.serviceTypeId,
                  hourlyRate: update.hourlyRate,
                  updatedAt: new Date(),
                });
          }),
        ],
      });
    });
    if (saved.state !== "committed") throw new MassageError(503, "Chưa xác nhận được cấu hình thưởng đã lưu.");
  } else {
    await idempotentTransaction(operationId, "lưu cấu hình thưởng tiền công", "employee-bonus-config.update", { ...input, businessId }, async (tx) => {
      const [members, services] = await Promise.all([
        tx.select({ id: membersTable.id }).from(membersTable).where(and(
          eq(membersTable.businessId, businessId),
          isNull(membersTable.deletedAt),
        )),
        tx.select({ id: serviceTypesTable.id, name: serviceTypesTable.name, hourlyRate: serviceTypesTable.hourlyRate })
          .from(serviceTypesTable).where(eq(serviceTypesTable.businessId, businessId)),
      ]);
      const memberIds = new Set(members.map((row) => row.id));
      const serviceById = new Map(services.map((row) => [row.id, row]));
      for (const update of input.rates ?? []) {
        if (!memberIds.has(update.memberId)) throw new MassageError(404, "Không tìm thấy nhân viên đang hoạt động.");
        const service = serviceById.get(update.serviceTypeId);
        if (!service) throw new MassageError(404, "Không tìm thấy dịch vụ đang hoạt động.");
        if (update.hourlyRate !== null && update.hourlyRate <= service.hourlyRate) {
          throw new MassageError(400, `Tiền công thưởng của dịch vụ ${service.name} phải cao hơn mức hiện tại.`);
        }
      }
      await tx.insert(facilityBonusSettingsTable).values({
        id: 1, businessId, enabled: input.enabled, thresholdMinutes: input.thresholdMinutes, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [facilityBonusSettingsTable.businessId, facilityBonusSettingsTable.id],
        set: { enabled: input.enabled, thresholdMinutes: input.thresholdMinutes, updatedAt: new Date() },
      });
      for (const update of input.rates ?? []) {
        const id = bonusRateKey(update.memberId, update.serviceTypeId, businessId);
        if (update.hourlyRate === null) {
          await tx.delete(employeeServiceBonusRatesTable).where(and(
            eq(employeeServiceBonusRatesTable.id, id),
            eq(employeeServiceBonusRatesTable.businessId, businessId),
          ));
        } else {
          await tx.insert(employeeServiceBonusRatesTable).values({
            id,
            businessId,
            memberId: update.memberId,
            serviceTypeId: update.serviceTypeId,
            hourlyRate: update.hourlyRate,
            updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: employeeServiceBonusRatesTable.id,
            set: { hourlyRate: update.hourlyRate, updatedAt: new Date() },
          });
        }
      }
      return true;
    });
  }

  res.json(UpdateEmployeeBonusConfigResponse.parse(await readConfig(businessId)));
}));

export default router;
