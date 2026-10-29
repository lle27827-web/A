import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  CreateAttendanceBody,
  CreateAttendanceResponse,
  DeleteAttendanceParams,
  GetAttendanceSummaryQueryParams,
  GetAttendanceSummaryResponse,
  ListAttendanceQueryParams,
  ListAttendanceResponse,
  UpdateAttendanceBody,
  UpdateAttendanceParams,
  UpdateAttendanceResponse,
} from "@workspace/api-zod";
import { isWithinRetention, retentionCutoffDate } from "../lib/retention-window";
import {
  db,
  attendanceTable,
  isPartitionedStorageEnabled,
  membersTable,
  readPartitionedTable,
  readPartitionedRowById,
  type AttendanceStatus,
} from "@workspace/db";
import { noPermissions } from "../lib/facility-permissions";
import type { OwnerAuthStatus } from "../lib/owner-auth";
import { commitPartitionedMutations, deleteMutation, operationIdFromRequest, upsertMutation } from "../lib/partitioned-mutations";
import { escapeLikePattern, idempotentTransaction, MassageError } from "../lib/massage";
import { massageHandler } from "./massage-errors";
import { isActiveAttendanceMember, isEditableAttendanceDate } from "../lib/attendance-policy";

const router: IRouter = Router();

type AttendanceWrite = {
  memberId: number | null;
  employeeName: string;
  workDate: string;
  checkIn: string | null;
  checkOut: string | null;
  status: AttendanceStatus;
  note: string | null;
};

function toAttendanceResponse(record: typeof attendanceTable.$inferSelect) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

router.get("/attendance", async (req, res): Promise<void> => {
  const query = ListAttendanceQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const filters = [];
  const permissions = (res.locals.facilityAuth as OwnerAuthStatus | undefined)?.permissions ?? noPermissions();
  const cutoff = retentionCutoffDate();
  filters.push(gte(attendanceTable.workDate, cutoff));
  if (!permissions.allEmployees) filters.push(inArray(attendanceTable.memberId, permissions.employeeIds));
  if (query.data.date) {
    if (!isWithinRetention(query.data.date)) {
      res.status(400).json({ error: "Chỉ xem lịch sử chấm công trong 5 năm gần nhất." });
      return;
    }
    filters.push(eq(attendanceTable.workDate, query.data.date));
  }
  if (query.data.status) {
    filters.push(eq(attendanceTable.status, query.data.status as AttendanceStatus));
  }
  if (query.data.memberId !== undefined) {
    filters.push(eq(attendanceTable.memberId, query.data.memberId));
  }
  const search = query.data.search?.trim();
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    filters.push(
      or(
        ilike(attendanceTable.employeeName, pattern),
        ilike(attendanceTable.note, pattern),
      ),
    );
  }

  let records: (typeof attendanceTable.$inferSelect)[];
  if (isPartitionedStorageEnabled()) {
    const searchText = search?.toLocaleLowerCase("vi");
    records = (await readPartitionedTable("attendance") as unknown as (typeof attendanceTable.$inferSelect)[])
      .filter((record) =>
        record.workDate >= cutoff &&
        (permissions.allEmployees || permissions.employeeIds.includes(record.memberId ?? 0)) &&
        (!query.data.date || record.workDate === query.data.date) &&
        (!query.data.status || record.status === query.data.status) &&
        (query.data.memberId === undefined || record.memberId === query.data.memberId) &&
        (!searchText || record.employeeName.toLocaleLowerCase("vi").includes(searchText) ||
          (record.note ?? "").toLocaleLowerCase("vi").includes(searchText)),
      )
      .sort((a, b) => b.workDate.localeCompare(a.workDate) || a.employeeName.localeCompare(b.employeeName, "vi"));
  } else {
    records = await db
      .select()
      .from(attendanceTable)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(attendanceTable.workDate), asc(attendanceTable.employeeName));
  }

  res.json(ListAttendanceResponse.parse(records.map(toAttendanceResponse)));
});

router.get("/attendance/summary", async (req, res): Promise<void> => {
  const query = GetAttendanceSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const workDate = query.data.date;
  if (!isWithinRetention(workDate)) {
    res.status(400).json({ error: "Chỉ xem lịch sử chấm công trong 5 năm gần nhất." });
    return;
  }
  const permissions = (res.locals.facilityAuth as OwnerAuthStatus | undefined)?.permissions ?? noPermissions();
  let row: { total: number; present: number; late: number; absent: number; leave: number; checkedIn: number; checkedOut: number };
  if (isPartitionedStorageEnabled()) {
    const records = (await readPartitionedTable("attendance") as unknown as (typeof attendanceTable.$inferSelect)[])
      .filter((item) => item.workDate === workDate &&
        (permissions.allEmployees || permissions.employeeIds.includes(item.memberId ?? 0)));
    row = {
      total: records.length,
      present: records.filter((item) => item.status === "present").length,
      late: records.filter((item) => item.status === "late").length,
      absent: records.filter((item) => item.status === "absent").length,
      leave: records.filter((item) => item.status === "leave").length,
      checkedIn: records.filter((item) => item.checkIn !== null).length,
      checkedOut: records.filter((item) => item.checkOut !== null).length,
    };
  } else {
    const [queryRow] = await db
      .select({
        total: count(),
        present: sql<number>`count(*) filter (where ${attendanceTable.status} = 'present')`,
        late: sql<number>`count(*) filter (where ${attendanceTable.status} = 'late')`,
        absent: sql<number>`count(*) filter (where ${attendanceTable.status} = 'absent')`,
        leave: sql<number>`count(*) filter (where ${attendanceTable.status} = 'leave')`,
        checkedIn: sql<number>`count(*) filter (where ${attendanceTable.checkIn} is not null)`,
        checkedOut: sql<number>`count(*) filter (where ${attendanceTable.checkOut} is not null)`,
      })
      .from(attendanceTable)
      .where(and(eq(attendanceTable.workDate, workDate),
        permissions.allEmployees ? undefined : inArray(attendanceTable.memberId, permissions.employeeIds)));
    row = queryRow;
  }

  res.json(GetAttendanceSummaryResponse.parse({
    date: workDate,
    total: Number(row.total),
    present: Number(row.present),
    late: Number(row.late),
    absent: Number(row.absent),
    leave: Number(row.leave),
    checkedIn: Number(row.checkedIn),
    checkedOut: Number(row.checkedOut),
  }));
});

router.post("/attendance", massageHandler(async (req, res): Promise<void> => {
  const parsed = CreateAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!isEditableAttendanceDate(parsed.data.workDate)) {
    res.status(400).json({ error: "Chỉ ghi chấm công trong 5 năm gần nhất." });
    return;
  }
  const operationId = operationIdFromRequest(req.get("Idempotency-Key"), "chấm công");

  const values: AttendanceWrite = {
    memberId: parsed.data.memberId,
    employeeName: parsed.data.employeeName,
    workDate: parsed.data.workDate,
    checkIn: parsed.data.checkIn ?? null,
    checkOut: parsed.data.checkOut ?? null,
    status: parsed.data.status as AttendanceStatus,
    note: parsed.data.note ?? null,
  };
  if (values.memberId === null) {
    res.status(400).json({ error: "Cần chọn nhân viên." });
    return;
  }
  const member = isPartitionedStorageEnabled()
    ? await readPartitionedRowById<typeof membersTable.$inferSelect>("members", values.memberId)
    : (await db.select().from(membersTable)
      .where(and(eq(membersTable.id, values.memberId), isNull(membersTable.deletedAt))).limit(1))[0];
  if (!isActiveAttendanceMember(member)) {
    res.status(400).json({ error: "Không tìm thấy nhân viên đang hoạt động được chọn." });
    return;
  }
  values.employeeName = member.name;

  if (isPartitionedStorageEnabled()) {
    const operation = await commitPartitionedMutations({
      operationId,
      lockName: `attendance:${values.memberId}`,
      action: "attendance.create",
      request: values,
      expectedEventCount: 1,
      idAllocations: { attendance: 1 },
      build: (reserved) => {
        const id = reserved.allocatedIds.attendance?.[0];
        if (!id) throw new MassageError(503, "Không cấp được mã chấm công.");
        const now = new Date();
        return [upsertMutation("attendance", id, { ...values, id, createdAt: now, updatedAt: now })];
      },
    });
    const id = operation.allocatedIds.attendance?.[0];
    const record = (await readPartitionedTable("attendance") as unknown as (typeof attendanceTable.$inferSelect)[])
      .find((item) => item.id === id);
    if (!record) throw new MassageError(503, "Không tải lại được chấm công sau khi lưu.");
    res.status(201).json(CreateAttendanceResponse.parse(toAttendanceResponse(record)));
    return;
  }
  const record = await idempotentTransaction(
    operationId,
    "chấm công",
    "attendance.create",
    values,
    async (tx) => (await tx.insert(attendanceTable).values(values).returning())[0],
  );
  res.status(201).json(CreateAttendanceResponse.parse(toAttendanceResponse(record)));
}));

router.patch("/attendance/:id", massageHandler(async (req, res): Promise<void> => {
  const params = UpdateAttendanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAttendanceBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body ?? {}).length === 0) {
    res.status(400).json({
      error: parsed.success ? "Cần có ít nhất một trường để cập nhật." : parsed.error.message,
    });
    return;
  }
  if (parsed.data.workDate !== undefined && !isEditableAttendanceDate(parsed.data.workDate)) {
    res.status(400).json({ error: "Chỉ ghi chấm công trong 5 năm gần nhất." });
    return;
  }
  const operationId = operationIdFromRequest(req.get("Idempotency-Key"), "sửa chấm công");

  const update: Partial<AttendanceWrite> = {};
  if (parsed.data.employeeName !== undefined) update.employeeName = parsed.data.employeeName;
  if ("memberId" in parsed.data) {
    const memberId = parsed.data.memberId ?? null;
    update.memberId = memberId;
    if (memberId !== null) {
      const member = isPartitionedStorageEnabled()
        ? await readPartitionedRowById<typeof membersTable.$inferSelect>("members", memberId)
        : (await db.select().from(membersTable)
          .where(and(eq(membersTable.id, memberId), isNull(membersTable.deletedAt))).limit(1))[0];
      if (!isActiveAttendanceMember(member)) {
        res.status(400).json({ error: "Không tìm thấy nhân viên đang hoạt động được chọn." });
        return;
      }
      update.employeeName = member.name;
    }
  }
  if (parsed.data.workDate !== undefined) update.workDate = parsed.data.workDate;
  if ("checkIn" in parsed.data) update.checkIn = parsed.data.checkIn ?? null;
  if ("checkOut" in parsed.data) update.checkOut = parsed.data.checkOut ?? null;
  if (parsed.data.status !== undefined) update.status = parsed.data.status as AttendanceStatus;
  if ("note" in parsed.data) update.note = parsed.data.note ?? null;

  if (isPartitionedStorageEnabled()) {
    const old = await readPartitionedRowById<typeof attendanceTable.$inferSelect>("attendance", params.data.id);
    if (!old) {
      res.status(404).json({ error: "Không tìm thấy bản ghi chấm công." });
      return;
    }
    if (!isEditableAttendanceDate(old.workDate)) {
      res.status(400).json({ error: "Chỉ sửa chấm công trong 5 năm gần nhất." });
      return;
    }
    const next = { ...old, ...update, updatedAt: new Date() };
    await commitPartitionedMutations({
      operationId,
      lockName: `attendance:${old.memberId ?? old.id}`,
      action: "attendance.update",
      request: { id: params.data.id, update },
      expectedEventCount: 1,
      build: () => [upsertMutation("attendance", old.id, next)],
    });
    const record = (await readPartitionedTable("attendance") as unknown as (typeof attendanceTable.$inferSelect)[])
      .find((item) => item.id === old.id);
    if (!record) throw new MassageError(503, "Không tải lại được chấm công sau khi sửa.");
    res.json(UpdateAttendanceResponse.parse(toAttendanceResponse(record)));
    return;
  }
  const record = await idempotentTransaction(
    operationId,
    "sửa chấm công",
    "attendance.update",
    { id: params.data.id, update },
    async (tx) => (await tx.update(attendanceTable)
      .set(update)
      .where(and(eq(attendanceTable.id, params.data.id),
        gte(attendanceTable.workDate, retentionCutoffDate()),
        res.locals.facilityAuth?.permissions.allEmployees ? undefined
          : inArray(attendanceTable.memberId, res.locals.facilityAuth?.permissions.employeeIds ?? [])))
      .returning())[0],
  );

  if (!record) {
    res.status(404).json({ error: "Không tìm thấy bản ghi chấm công." });
    return;
  }

  res.json(UpdateAttendanceResponse.parse(toAttendanceResponse(record)));
}));

router.delete("/attendance/:id", massageHandler(async (req, res): Promise<void> => {
  const params = DeleteAttendanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const operationId = operationIdFromRequest(req.get("Idempotency-Key"), "xóa chấm công");

  if (isPartitionedStorageEnabled()) {
    const old = await readPartitionedRowById<typeof attendanceTable.$inferSelect>("attendance", params.data.id);
    if (!old || (!res.locals.facilityAuth?.permissions.allEmployees &&
        !res.locals.facilityAuth?.permissions.employeeIds.includes(old.memberId ?? 0))) {
      res.status(404).json({ error: "Không tìm thấy bản ghi chấm công." });
      return;
    }
    await commitPartitionedMutations({
      operationId,
      lockName: `attendance:${old.memberId ?? old.id}`,
      action: "attendance.delete",
      request: { id: params.data.id },
      expectedEventCount: 1,
      build: () => [deleteMutation("attendance", old.id)],
    });
    res.sendStatus(204);
    return;
  }
  const record = await idempotentTransaction(
    operationId,
    "xóa chấm công",
    "attendance.delete",
    { id: params.data.id },
    async (tx) => (await tx.delete(attendanceTable)
      .where(and(eq(attendanceTable.id, params.data.id),
        res.locals.facilityAuth?.permissions.allEmployees ? undefined
          : inArray(attendanceTable.memberId, res.locals.facilityAuth?.permissions.employeeIds ?? [])))
      .returning({ id: attendanceTable.id }))[0],
  );

  if (!record) {
    res.status(404).json({ error: "Không tìm thấy bản ghi chấm công." });
    return;
  }

  res.sendStatus(204);
}));

export default router;
