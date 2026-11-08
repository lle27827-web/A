import { Router, type IRouter, type Response } from "express";
import { and, asc, eq, gte } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  employeeAvailabilityTable,
  isPartitionedStorageEnabled,
  membersTable,
  readPartitionedTable,
  serviceSessionsTable,
} from "@workspace/db";
import {
  CreateAppointmentBody,
  CreateAppointmentResponse,
  DeleteAppointmentParams,
  ListAppointmentStaffActivityResponse,
  ListAppointmentsResponse,
  UpdateAppointmentBody,
  UpdateAppointmentStaffActivityBody,
  UpdateAppointmentStaffActivityParams,
  UpdateAppointmentStaffActivityResponse,
  UpdateAppointmentParams,
  UpdateAppointmentResponse,
  type AppointmentInput,
} from "@workspace/api-zod";
import { idempotentTransaction, MassageError } from "../lib/massage";
import { listMembersForPeriod } from "../lib/employee-history";
import {
  deriveStaffActivity,
  hoChiMinhDate,
  isAppointmentOnOrAfterHoChiMinhDate,
} from "../lib/employee-availability";
import { retentionCutoffDate } from "../lib/retention-window";
import { massageHandler, parseInput } from "./massage-errors";
import { commitPartitionedMutations, operationIdFromRequest, upsertMutation, deleteMutation } from "../lib/partitioned-mutations";
import type { OwnerAuthStatus } from "../lib/owner-auth";
import { isMaskedCustomerPhone, maskCustomerPhone } from "../lib/customer-phone";

const router: IRouter = Router();
const businessIdFor = (res: Response) =>
  (res.locals.facilityAuth as OwnerAuthStatus | undefined)?.businessId ?? "00000000-0000-4000-8000-000000000001";

function scheduledAtTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function output(row: typeof appointmentsTable.$inferSelect, isOwner: boolean) {
  return {
    ...row,
    phone: row.phone ? isOwner ? row.phone : maskCustomerPhone(row.phone) : "",
    scheduledAt: row.scheduledAt.toISOString(),
    request: row.request ?? "",
    note: row.note ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isOwnerView(res: Response): boolean {
  return (res.locals.facilityAuth as OwnerAuthStatus | undefined)?.isOwner === true;
}

function normalizedInput(
  input: AppointmentInput,
  previous?: typeof appointmentsTable.$inferSelect,
) {
  const customerName = input.customerName?.trim() ?? previous?.customerName ?? "";
  const phone = input.phone?.trim() ?? previous?.phone ?? "";
  const scheduledAt = new Date(input.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime())) throw new MassageError(400, "Ngày giờ hẹn không hợp lệ.");
  if (customerName.length > 160) throw new MassageError(400, "Tên khách không được dài quá 160 ký tự.");
  if (phone.length > 40) throw new MassageError(400, "Số điện thoại không được dài quá 40 ký tự.");
  return {
    customerName,
    phone,
    scheduledAt,
    memberId: input.memberId === undefined ? previous?.memberId ?? null : input.memberId,
    request: input.request?.trim() ?? previous?.request ?? "",
    note: input.note?.trim() ?? previous?.note ?? "",
  };
}

async function requireActiveMember(memberId: number | null, businessId: string) {
  if (memberId === null) return;
  const members = await listMembersForPeriod(undefined, undefined, businessId);
  if (!members.some((member) => member.id === memberId)) {
    throw new MassageError(404, "Không tìm thấy nhân viên đang hoạt động.");
  }
}

router.get("/appointments", massageHandler(async (_req, res) => {
  const businessId = businessIdFor(res);
  res.set("Cache-Control", "private, no-store");
  const now = new Date();
  const todayInVietnam = hoChiMinhDate(now);
  const startOfVietnamDay = new Date(`${todayInVietnam}T00:00:00.000+07:00`);
  const rows = isPartitionedStorageEnabled()
    ? (await readPartitionedTable("appointments", { businessId }) as unknown as (typeof appointmentsTable.$inferSelect)[])
      .filter((row) => isAppointmentOnOrAfterHoChiMinhDate(row.scheduledAt, now))
      .sort((a, b) => scheduledAtTime(a.scheduledAt) - scheduledAtTime(b.scheduledAt))
    : await db.select().from(appointmentsTable)
      .where(and(eq(appointmentsTable.businessId, businessId), gte(appointmentsTable.scheduledAt, startOfVietnamDay)))
      .orderBy(asc(appointmentsTable.scheduledAt));
  res.json(ListAppointmentsResponse.parse(rows.map((row) => output(row, isOwnerView(res)))));
}));

async function staffActivityRows(businessId: string) {
  const membersPromise = listMembersForPeriod(undefined, undefined, businessId);
  const [members, sessions, manualStatuses, appointments] = isPartitionedStorageEnabled()
    ? await Promise.all([
        membersPromise,
        readPartitionedTable("service_sessions", { businessId }),
        readPartitionedTable("employee_availability", { businessId }),
        readPartitionedTable("appointments", { businessId }),
      ])
    : await Promise.all([
        membersPromise,
        db.select().from(serviceSessionsTable).where(and(
          eq(serviceSessionsTable.businessId, businessId),
          gte(serviceSessionsTable.workDate, retentionCutoffDate()),
        )),
        db.select().from(employeeAvailabilityTable).where(eq(employeeAvailabilityTable.businessId, businessId)),
        db.select().from(appointmentsTable).where(and(
          eq(appointmentsTable.businessId, businessId),
          eq(appointmentsTable.status, "scheduled"),
        )),
      ]);
  return deriveStaffActivity(
    (members as unknown as (typeof membersTable.$inferSelect)[]).map(({ id, name }) => ({ id, name })),
    (sessions as unknown as (typeof serviceSessionsTable.$inferSelect)[]),
    (manualStatuses as unknown as (typeof employeeAvailabilityTable.$inferSelect)[]),
    new Date(),
    (appointments as unknown as (typeof appointmentsTable.$inferSelect)[]),
  );
}

router.get("/appointments/staff-activity", massageHandler(async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(ListAppointmentStaffActivityResponse.parse(await staffActivityRows(businessIdFor(res))));
}));

router.patch("/appointments/staff-activity/:memberId", massageHandler(async (req, res) => {
  const businessId = businessIdFor(res);
  const { memberId } = parseInput(UpdateAppointmentStaffActivityParams, req.params);
  const { state } = parseInput(UpdateAppointmentStaffActivityBody, req.body);
  const members = await listMembersForPeriod(undefined, undefined, businessId);
  const member = members.find((row) => row.id === memberId);
  if (!member) throw new MassageError(404, "Không tìm thấy nhân viên đang hoạt động.");

  const existing = isPartitionedStorageEnabled()
    ? (await readPartitionedTable("employee_availability", { businessId }) as unknown as (typeof employeeAvailabilityTable.$inferSelect)[])
      .find((row) => row.memberId === memberId)
    : (await db.select().from(employeeAvailabilityTable).where(and(
      eq(employeeAvailabilityTable.memberId, memberId),
      eq(employeeAvailabilityTable.businessId, businessId),
    )).limit(1))[0];
  if (state === "off") {
    const current = (await staffActivityRows(businessId)).find((row) => row.memberId === memberId);
    if (current?.state === "working") {
      throw new MassageError(409, "Nhân viên đang có ca làm. Có thể đánh dấu nghỉ sau khi ca kết thúc.");
    }
  }

  const operationId = operationIdFromRequest(req.get("Idempotency-Key"), "cập nhật tình trạng nhân viên");
  if (isPartitionedStorageEnabled()) {
    if (state === "off") {
      await commitPartitionedMutations({
        operationId,
        lockName: `employee-availability:${memberId}`,
        action: "employee-availability.update",
        request: { memberId, state, statusDate: hoChiMinhDate(), businessId },
        expectedEventCount: 1,
        build: () => [upsertMutation("employee_availability", memberId, {
          businessId,
          memberId,
          employeeName: member.name,
          statusDate: hoChiMinhDate(),
          state: "off",
          updatedAt: new Date(),
        })],
      });
    } else if (existing) {
      await commitPartitionedMutations({
        operationId,
        lockName: `employee-availability:${memberId}`,
        action: "employee-availability.update",
        request: { memberId, state, statusDate: hoChiMinhDate(), businessId },
        expectedEventCount: 1,
        build: () => [deleteMutation("employee_availability", memberId)],
      });
    }
  } else if (state === "off") {
    await db.insert(employeeAvailabilityTable).values({
      businessId,
      memberId,
      employeeName: member.name,
      statusDate: hoChiMinhDate(),
      state: "off",
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: employeeAvailabilityTable.memberId,
      set: { employeeName: member.name, statusDate: hoChiMinhDate(), state: "off", updatedAt: new Date() },
    });
  } else {
    await db.delete(employeeAvailabilityTable).where(and(
      eq(employeeAvailabilityTable.memberId, memberId),
      eq(employeeAvailabilityTable.businessId, businessId),
      eq(employeeAvailabilityTable.statusDate, hoChiMinhDate()),
    ));
  }

  const updated = (await staffActivityRows(businessId)).find((row) => row.memberId === memberId);
  if (!updated) throw new MassageError(404, "Không tìm thấy nhân viên đang hoạt động.");
  res.json(UpdateAppointmentStaffActivityResponse.parse(updated));
}));

router.post("/appointments", massageHandler(async (req, res) => {
  const businessId = businessIdFor(res);
  const input = normalizedInput(parseInput(CreateAppointmentBody, req.body));
  await requireActiveMember(input.memberId, businessId);
  const values = { ...input, businessId };
  if (isPartitionedStorageEnabled()) {
    const operationId = operationIdFromRequest(req.get("Idempotency-Key"), "lịch hẹn");
    const operation = await commitPartitionedMutations({
      operationId,
      lockName: "appointments",
      action: "appointment.create",
      request: values,
      expectedEventCount: 1,
      idAllocations: { appointments: 1 },
      build: (reserved) => {
        const id = reserved.allocatedIds.appointments?.[0];
        if (!id) throw new MassageError(503, "Không cấp được mã lịch hẹn.");
        const now = new Date();
        return [upsertMutation("appointments", id, {
          ...values, id, status: "scheduled", createdAt: now, updatedAt: now,
        })];
      },
    });
    const id = operation.allocatedIds.appointments?.[0];
    const row = (await readPartitionedTable("appointments", { businessId }) as unknown as (typeof appointmentsTable.$inferSelect)[])
      .find((item) => item.id === id);
    if (!row) throw new MassageError(503, "Không tải lại được lịch hẹn sau khi lưu.");
    res.status(201).json(CreateAppointmentResponse.parse(output(row, isOwnerView(res))));
    return;
  }
  const row = await idempotentTransaction(
    operationIdFromRequest(req.get("Idempotency-Key"), "tạo lịch hẹn"),
    "tạo lịch hẹn",
    "appointment.create",
    values,
    async (tx) => (await tx.insert(appointmentsTable).values(values).returning())[0],
  );
  res.status(201).json(CreateAppointmentResponse.parse(output(row, isOwnerView(res))));
}));

router.patch("/appointments/:id", massageHandler(async (req, res) => {
  const businessId = businessIdFor(res);
  const { id } = parseInput(UpdateAppointmentParams, req.params);
  const body = parseInput(UpdateAppointmentBody, req.body);
  const previous = isPartitionedStorageEnabled()
    ? (await readPartitionedTable("appointments", { businessId }) as unknown as (typeof appointmentsTable.$inferSelect)[])
      .find((item) => item.id === id)
    : (await db.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.id, id),
      eq(appointmentsTable.businessId, businessId),
    )).limit(1))[0];
  if (!previous) throw new MassageError(404, "Không tìm thấy lịch hẹn.");
  const normalized = normalizedInput(body, previous);
  if (normalized.memberId !== previous.memberId) await requireActiveMember(normalized.memberId, businessId);
  const input = !isOwnerView(res) && isMaskedCustomerPhone(normalized.phone)
    ? (({ phone: _masked, ...fields }) => fields)(normalized)
    : normalized;
  if (!Object.keys(input).length) throw new MassageError(400, "Chưa có thông tin cần cập nhật.");
  if (isPartitionedStorageEnabled()) {
    await commitPartitionedMutations({
      operationId: operationIdFromRequest(req.get("Idempotency-Key"), "lịch hẹn"),
      lockName: `appointment:${id}`,
      action: "appointment.update",
      request: { id, input, businessId },
      expectedEventCount: 1,
      build: () => [upsertMutation("appointments", id, {
        ...previous, ...input, updatedAt: new Date(),
      })],
    });
    const row = (await readPartitionedTable("appointments", { businessId }) as unknown as (typeof appointmentsTable.$inferSelect)[])
      .find((item) => item.id === id);
    if (!row) throw new MassageError(503, "Không tải lại được lịch hẹn sau khi sửa.");
    res.json(UpdateAppointmentResponse.parse(output(row, isOwnerView(res))));
    return;
  }
  const row = await idempotentTransaction(
    operationIdFromRequest(req.get("Idempotency-Key"), "sửa lịch hẹn"),
    "sửa lịch hẹn",
    "appointment.update",
    { id, input, businessId },
    async (tx) => (await tx.update(appointmentsTable)
      .set({ ...input, updatedAt: new Date() })
      .where(and(
        eq(appointmentsTable.id, id),
        eq(appointmentsTable.businessId, businessId),
      ))
      .returning())[0],
  );
  if (!row) throw new MassageError(404, "Không tìm thấy lịch hẹn.");
  res.json(UpdateAppointmentResponse.parse(output(row, isOwnerView(res))));
}));

router.delete("/appointments/:id", massageHandler(async (req, res) => {
  const businessId = businessIdFor(res);
  const { id } = parseInput(DeleteAppointmentParams, req.params);
  if (isPartitionedStorageEnabled()) {
    const rows = await readPartitionedTable("appointments", { businessId }) as unknown as (typeof appointmentsTable.$inferSelect)[];
    if (!rows.some((item) => item.id === id)) throw new MassageError(404, "Không tìm thấy lịch hẹn.");
    await commitPartitionedMutations({
      operationId: operationIdFromRequest(req.get("Idempotency-Key"), "lịch hẹn"),
      lockName: `appointment:${id}`,
      action: "appointment.delete",
      request: { id, businessId },
      expectedEventCount: 1,
      build: () => [deleteMutation("appointments", id)],
    });
    res.sendStatus(204);
    return;
  }
  const row = await idempotentTransaction(
    operationIdFromRequest(req.get("Idempotency-Key"), "xóa lịch hẹn"),
    "xóa lịch hẹn",
    "appointment.delete",
    { id, businessId },
    async (tx) => (await tx.delete(appointmentsTable)
      .where(and(
        eq(appointmentsTable.id, id),
        eq(appointmentsTable.businessId, businessId),
      ))
      .returning({ id: appointmentsTable.id }))[0],
  );
  if (!row) throw new MassageError(404, "Không tìm thấy lịch hẹn.");
  res.sendStatus(204);
}));

export default router;
