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
  membersTable,
  type AttendanceStatus,
} from "@workspace/db";
import { noPermissions } from "../lib/facility-permissions";
import type { OwnerAuthStatus } from "../lib/owner-auth";

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
    const pattern = `%${search}%`;
    filters.push(
      or(
        ilike(attendanceTable.employeeName, pattern),
        ilike(attendanceTable.note, pattern),
      ),
    );
  }

  const records = await db
    .select()
    .from(attendanceTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(attendanceTable.workDate), asc(attendanceTable.employeeName));

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
  const [row] = await db
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

router.post("/attendance", async (req, res): Promise<void> => {
  const parsed = CreateAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!isWithinRetention(parsed.data.workDate)) {
    res.status(400).json({ error: "Chỉ ghi chấm công trong 5 năm gần nhất." });
    return;
  }

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
    res.status(400).json({ error: "Cần chọn thành viên." });
    return;
  }
  const [member] = await db.select().from(membersTable)
    .where(and(eq(membersTable.id, values.memberId), isNull(membersTable.deletedAt))).limit(1);
  if (!member) {
    res.status(400).json({ error: "Không tìm thấy thành viên được chọn." });
    return;
  }
  values.employeeName = member.name;

  const [record] = await db.insert(attendanceTable).values(values).returning();
  res.status(201).json(CreateAttendanceResponse.parse(toAttendanceResponse(record)));
});

router.patch("/attendance/:id", async (req, res): Promise<void> => {
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
  if (parsed.data.workDate !== undefined && !isWithinRetention(parsed.data.workDate)) {
    res.status(400).json({ error: "Chỉ ghi chấm công trong 5 năm gần nhất." });
    return;
  }

  const update: Partial<AttendanceWrite> = {};
  if (parsed.data.employeeName !== undefined) update.employeeName = parsed.data.employeeName;
  if ("memberId" in parsed.data) {
    const memberId = parsed.data.memberId ?? null;
    update.memberId = memberId;
    if (memberId !== null) {
      const [member] = await db.select().from(membersTable)
        .where(and(eq(membersTable.id, memberId), isNull(membersTable.deletedAt))).limit(1);
      if (!member) {
        res.status(400).json({ error: "Không tìm thấy thành viên được chọn." });
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

  const [record] = await db
    .update(attendanceTable)
    .set(update)
    .where(and(eq(attendanceTable.id, params.data.id),
      gte(attendanceTable.workDate, retentionCutoffDate()),
      res.locals.facilityAuth?.permissions.allEmployees ? undefined
        : inArray(attendanceTable.memberId, res.locals.facilityAuth?.permissions.employeeIds ?? [])))
    .returning();

  if (!record) {
    res.status(404).json({ error: "Không tìm thấy bản ghi chấm công." });
    return;
  }

  res.json(UpdateAttendanceResponse.parse(toAttendanceResponse(record)));
});

router.delete("/attendance/:id", async (req, res): Promise<void> => {
  const params = DeleteAttendanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [record] = await db
    .delete(attendanceTable)
    .where(and(eq(attendanceTable.id, params.data.id),
      res.locals.facilityAuth?.permissions.allEmployees ? undefined
        : inArray(attendanceTable.memberId, res.locals.facilityAuth?.permissions.employeeIds ?? [])))
    .returning({ id: attendanceTable.id });

  if (!record) {
    res.status(404).json({ error: "Không tìm thấy bản ghi chấm công." });
    return;
  }

  res.sendStatus(204);
});

export default router;
