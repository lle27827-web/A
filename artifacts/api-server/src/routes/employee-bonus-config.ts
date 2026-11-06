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
import { massageHandler, parseInput } from "./massage-errors";

const router: IRouter = Router();

async function readConfig() {
  if (isPartitionedStorageEnabled()) {
    const [membersRaw, servicesRaw, settingsRaw, ratesRaw] = await Promise.all([
      readPartitionedTable("members"),
      readPartitionedTable("service_types"),
      readPartitionedTable("facility_bonus_settings"),
      readPartitionedTable("employee_service_bonus_rates"),
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
      .where(isNull(membersTable.deletedAt)).orderBy(asc(membersTable.name)),
    db.select({
      id: serviceTypesTable.id, name: serviceTypesTable.name, hourlyRate: serviceTypesTable.hourlyRate,
    }).from(serviceTypesTable).orderBy(asc(serviceTypesTable.name)),
    db.select().from(facilityBonusSettingsTable).where(eq(facilityBonusSettingsTable.id, 1)).limit(1),
    db.select({
      memberId: employeeServiceBonusRatesTable.memberId,
      serviceTypeId: employeeServiceBonusRatesTable.serviceTypeId,
      hourlyRate: employeeServiceBonusRatesTable.hourlyRate,
    }).from(employeeServiceBonusRatesTable),
  ]);
  return {
    enabled: settings[0]?.enabled ?? false,
    thresholdMinutes: settings[0]?.thresholdMinutes ?? 0,
    members,
    services,
    rates,
  };
}

router.get("/employee-bonus-config", massageHandler(async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(GetEmployeeBonusConfigResponse.parse(await readConfig()));
}));

router.patch("/employee-bonus-config", massageHandler(async (req, res) => {
  const input = parseInput(UpdateEmployeeBonusConfigBody, req.body);
  const operationId = operationIdFromRequest(req.get("Idempotency-Key"), "lưu cấu hình thưởng tiền công");
  if (input.enabled && input.thresholdMinutes < 1) {
    throw new MassageError(400, "Nhập ngưỡng giờ lớn hơn 0 trước khi bật thưởng tiền công.");
  }
  const uniqueRateKeys = new Set(input.rates?.map(({ memberId, serviceTypeId }) =>
    employeeBonusRateKey(memberId, serviceTypeId),
  ) ?? []);
  if (uniqueRateKeys.size !== (input.rates?.length ?? 0)) {
    throw new MassageError(400, "Không được lặp cùng một nhân viên và dịch vụ trong bảng giá.");
  }

  if (isPartitionedStorageEnabled()) {
    const saved = await withPartitionWriteMutex("employee-bonus-config", async () => {
      const [membersRaw, servicesRaw] = await Promise.all([
        readPartitionedTable("members"),
        readPartitionedTable("service_types"),
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
        request: input,
        expectedEventCount: 1 + (input.rates?.length ?? 0),
        build: () => [
          upsertMutation("facility_bonus_settings", 1, {
            id: 1,
            enabled: input.enabled,
            thresholdMinutes: input.thresholdMinutes,
            updatedAt: new Date(),
          }),
          ...(input.rates ?? []).map((update) => {
            const key = employeeBonusRateKey(update.memberId, update.serviceTypeId);
            return update.hourlyRate === null
              ? deleteMutation("employee_service_bonus_rates", key)
              : upsertMutation("employee_service_bonus_rates", key, {
                  id: key,
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
    await idempotentTransaction(operationId, "lưu cấu hình thưởng tiền công", "employee-bonus-config.update", input, async (tx) => {
      const [members, services] = await Promise.all([
        tx.select({ id: membersTable.id }).from(membersTable).where(isNull(membersTable.deletedAt)),
        tx.select({ id: serviceTypesTable.id, name: serviceTypesTable.name, hourlyRate: serviceTypesTable.hourlyRate })
          .from(serviceTypesTable),
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
        id: 1, enabled: input.enabled, thresholdMinutes: input.thresholdMinutes, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: facilityBonusSettingsTable.id,
        set: { enabled: input.enabled, thresholdMinutes: input.thresholdMinutes, updatedAt: new Date() },
      });
      for (const update of input.rates ?? []) {
        const id = employeeBonusRateKey(update.memberId, update.serviceTypeId);
        if (update.hourlyRate === null) {
          await tx.delete(employeeServiceBonusRatesTable).where(eq(employeeServiceBonusRatesTable.id, id));
        } else {
          await tx.insert(employeeServiceBonusRatesTable).values({
            id,
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

  res.json(UpdateEmployeeBonusConfigResponse.parse(await readConfig()));
}));

export default router;
