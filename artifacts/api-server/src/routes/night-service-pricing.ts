import { Router, type IRouter, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  facilityNightSettingsTable,
  isPartitionedStorageEnabled,
  readPartitionedTable,
  serviceTypesTable,
  withPartitionWriteMutex,
} from "@workspace/db";
import {
  GetNightServicePricingResponse,
  UpdateNightServicePricingBody,
  UpdateNightServicePricingResponse,
} from "@workspace/api-zod";
import { MassageError, idempotentTransaction } from "../lib/massage";
import { commitPartitionedMutations, operationIdFromRequest, upsertMutation } from "../lib/partitioned-mutations";
import { requireOwner } from "../lib/owner-auth";
import { massageHandler, parseInput } from "./massage-errors";
import { parseClockMinutes } from "../lib/night-service-pricing";
import type { OwnerAuthStatus } from "../lib/owner-auth";

const router: IRouter = Router();
const businessIdFor = (res: Response) =>
  (res.locals.facilityAuth as OwnerAuthStatus | undefined)?.businessId ?? "00000000-0000-4000-8000-000000000001";

async function readConfig(businessId: string) {
  if (isPartitionedStorageEnabled()) {
    const [settingsRaw, servicesRaw] = await Promise.all([
      readPartitionedTable("facility_night_settings", { businessId }),
      readPartitionedTable("service_types", { businessId }),
    ]);
    const settings = settingsRaw as unknown as (typeof facilityNightSettingsTable.$inferSelect)[];
    const services = servicesRaw as unknown as (typeof serviceTypesTable.$inferSelect)[];
    const config = settings.find((row) => row.id === 1);
    return {
      enabled: config?.enabled ?? false,
      startTime: config?.startTime ?? "22:00",
      endTime: config?.endTime ?? "06:00",
      rates: services.sort((a, b) => a.name.localeCompare(b.name, "vi")).map((service) => ({
        serviceTypeId: service.id,
        serviceName: service.name,
        standardCustomerHourlyRate: service.customerHourlyRate,
        standardEmployeeHourlyRate: service.hourlyRate,
        customerHourlyRate: service.nightCustomerHourlyRate,
        employeeHourlyRate: service.nightHourlyRate,
      })),
    };
  }
  const [settings, services] = await Promise.all([
    db.select().from(facilityNightSettingsTable).where(and(
      eq(facilityNightSettingsTable.businessId, businessId),
      eq(facilityNightSettingsTable.id, 1),
    )).limit(1),
    db.select().from(serviceTypesTable).where(eq(serviceTypesTable.businessId, businessId)).orderBy(asc(serviceTypesTable.name)),
  ]);
  return {
    enabled: settings[0]?.enabled ?? false,
    startTime: settings[0]?.startTime ?? "22:00",
    endTime: settings[0]?.endTime ?? "06:00",
    rates: services.map((service) => ({
      serviceTypeId: service.id,
      serviceName: service.name,
      standardCustomerHourlyRate: service.customerHourlyRate,
      standardEmployeeHourlyRate: service.hourlyRate,
      customerHourlyRate: service.nightCustomerHourlyRate,
      employeeHourlyRate: service.nightHourlyRate,
    })),
  };
}

function validateConfiguration(input: {
  enabled: boolean;
  startTime: string;
  endTime: string;
  rates: { serviceTypeId: number; customerHourlyRate: number | null; employeeHourlyRate: number | null }[];
}, services: (typeof serviceTypesTable.$inferSelect)[]) {
  const start = parseClockMinutes(input.startTime);
  const end = parseClockMinutes(input.endTime);
  if (start === null || end === null || start === end) {
    throw new MassageError(400, "Chọn giờ bắt đầu và kết thúc hợp lệ; hai giờ không được trùng nhau.");
  }
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const rateById = new Map(input.rates.map((rate) => [rate.serviceTypeId, rate]));
  if (rateById.size !== input.rates.length) throw new MassageError(400, "Không được lặp dịch vụ trong bảng giá ca đêm.");
  for (const rate of input.rates) {
    if (!serviceById.has(rate.serviceTypeId)) throw new MassageError(404, "Không tìm thấy dịch vụ đang hoạt động.");
    for (const value of [rate.customerHourlyRate, rate.employeeHourlyRate]) {
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > 10_000_000)) {
        throw new MassageError(400, "Mỗi mức giá ca đêm phải từ 1 đến 10.000.000 đồng/giờ.");
      }
    }
  }
  if (input.enabled) {
    const missing = services.find((service) => {
      const rate = rateById.get(service.id);
      return !rate || rate.customerHourlyRate === null || rate.employeeHourlyRate === null;
    });
    if (missing) throw new MassageError(400, `Hãy cài đủ giá khách trả và tiền công ca đêm cho dịch vụ ${missing.name}.`);
  }
  return rateById;
}

router.get("/night-service-pricing", requireOwner, massageHandler(async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(GetNightServicePricingResponse.parse(await readConfig(businessIdFor(res))));
}));

router.patch("/night-service-pricing", requireOwner, massageHandler(async (req, res) => {
  const businessId = businessIdFor(res);
  const input = parseInput(UpdateNightServicePricingBody, req.body);
  const operationId = operationIdFromRequest(req.get("Idempotency-Key"), "lưu giá dịch vụ ca đêm");
  if (isPartitionedStorageEnabled()) {
    const saved = await withPartitionWriteMutex("night-service-pricing", async () => {
      const servicesRaw = await readPartitionedTable("service_types", { businessId });
      const services = servicesRaw as unknown as (typeof serviceTypesTable.$inferSelect)[];
      const rates = validateConfiguration(input, services);
      const serviceUpdates = services.filter((service) => {
        const rate = rates.get(service.id);
        return service.nightCustomerHourlyRate !== (rate?.customerHourlyRate ?? null) ||
          service.nightHourlyRate !== (rate?.employeeHourlyRate ?? null);
      });
      const result = await commitPartitionedMutations({
        operationId,
        lockName: "night-service-pricing",
        alreadyLocked: true,
        action: "night-service-pricing.update",
        request: { ...input, businessId },
        expectedEventCount: serviceUpdates.length + 1,
        build: () => [
          upsertMutation("facility_night_settings", 1, {
            id: 1,
            businessId,
            enabled: input.enabled,
            startTime: input.startTime,
            endTime: input.endTime,
            updatedAt: new Date(),
          }),
          ...serviceUpdates.map((service) => {
            const rate = rates.get(service.id);
            return upsertMutation("service_types", service.id, {
              ...service,
              nightCustomerHourlyRate: rate?.customerHourlyRate ?? null,
              nightHourlyRate: rate?.employeeHourlyRate ?? null,
            });
          }),
        ],
      });
      return result;
    });
    if (saved.state !== "committed") throw new MassageError(503, "Chưa xác nhận được bảng giá ca đêm đã lưu.");
  } else {
    await idempotentTransaction(operationId, "lưu giá dịch vụ ca đêm", "night-service-pricing.update", { ...input, businessId }, async (tx) => {
      const services = await tx.select().from(serviceTypesTable).where(eq(serviceTypesTable.businessId, businessId));
      const rates = validateConfiguration(input, services);
      await tx.insert(facilityNightSettingsTable).values({
        id: 1, businessId, enabled: input.enabled, startTime: input.startTime, endTime: input.endTime, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [facilityNightSettingsTable.businessId, facilityNightSettingsTable.id],
        set: { enabled: input.enabled, startTime: input.startTime, endTime: input.endTime, updatedAt: new Date() },
      });
      for (const service of services) {
        const rate = rates.get(service.id);
        if (service.nightCustomerHourlyRate === (rate?.customerHourlyRate ?? null) &&
          service.nightHourlyRate === (rate?.employeeHourlyRate ?? null)) continue;
        await tx.update(serviceTypesTable).set({
          nightCustomerHourlyRate: rate?.customerHourlyRate ?? null,
          nightHourlyRate: rate?.employeeHourlyRate ?? null,
        }).where(and(
          eq(serviceTypesTable.id, service.id),
          eq(serviceTypesTable.businessId, businessId),
        ));
      }
      return true;
    });
  }
  res.json(UpdateNightServicePricingResponse.parse(await readConfig(businessId)));
}));

export default router;
