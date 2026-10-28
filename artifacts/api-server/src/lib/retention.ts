import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  attendanceTable,
  cardUsageHistoryTable,
  db,
  isPartitionedStorageEnabled,
  readPartitionedTable,
  serviceSessionsTable,
  personalSessionsTable,
} from "@workspace/db";
import { retentionCutoffDate } from "./retention-window";
import { commitPartitionedMutations, deleteMutation, operationIdFromRequest, upsertMutation } from "./partitioned-mutations";
import { MassageError } from "./massage";

export type RetentionYearSummary = {
  year: number;
  attendanceCount: number;
  serviceSessionCount: number;
  cardUseCount: number;
};

export async function listFacilityHistoryYears(): Promise<RetentionYearSummary[]> {
  if (isPartitionedStorageEnabled()) {
    const [attendanceRaw, sessionsRaw] = await Promise.all([
      readPartitionedTable("attendance"),
      readPartitionedTable("service_sessions"),
    ]);
    const attendance = attendanceRaw as unknown as (typeof attendanceTable.$inferSelect)[];
    const sessions = sessionsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[];
    const years = new Map<number, RetentionYearSummary>();
    for (const row of attendance) {
      const year = Number(row.workDate.slice(0, 4));
      const summary = years.get(year) ?? { year, attendanceCount: 0, serviceSessionCount: 0, cardUseCount: 0 };
      summary.attendanceCount += 1;
      years.set(year, summary);
    }
    for (const row of sessions) {
      const year = Number(row.workDate.slice(0, 4));
      const summary = years.get(year) ?? { year, attendanceCount: 0, serviceSessionCount: 0, cardUseCount: 0 };
      summary.serviceSessionCount += 1;
      if (row.cardId !== null) summary.cardUseCount += 1;
      years.set(year, summary);
    }
    return [...years.values()].sort((a, b) => b.year - a.year);
  }
  const result = await db.execute(sql`
    SELECT year,
      sum(attendance_count)::int AS "attendanceCount",
      sum(service_session_count)::int AS "serviceSessionCount",
      sum(card_use_count)::int AS "cardUseCount"
    FROM (
      SELECT extract(year FROM work_date)::int AS year,
        count(*)::int AS attendance_count,
        0::int AS service_session_count,
        0::int AS card_use_count
      FROM public.attendance
      GROUP BY 1

      UNION ALL

      SELECT extract(year FROM work_date)::int AS year,
        0::int AS attendance_count,
        count(*)::int AS service_session_count,
        count(*) FILTER (WHERE card_id IS NOT NULL)::int AS card_use_count
      FROM public.service_sessions
      GROUP BY 1
    ) AS yearly_history
    GROUP BY year
    ORDER BY year DESC
  `);

  return result.rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      year: Number(record.year),
      attendanceCount: Number(record.attendanceCount),
      serviceSessionCount: Number(record.serviceSessionCount),
      cardUseCount: Number(record.cardUseCount),
    };
  });
}

export async function deleteFacilityHistoryYear(year: number, _operationId?: string) {
  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;

  if (isPartitionedStorageEnabled()) {
    const result = await deleteFacilityHistoryDateRange({
      fromDate: startDate,
      toDate: `${year}-12-31`,
    });
    return { year, ...result };
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '15s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended('so-cong:history-retention', 0))
    `);

    const archived = await tx.execute(sql`
      WITH inserted AS (
        INSERT INTO public.card_usage_history (
          source_session_id, card_id, member_id, employee_name, customer_name,
          service_type, service_type_id, work_date, minutes, customer_hourly_rate,
          customer_charge, hourly_rate, earnings, note, created_at
        )
        SELECT
          id, card_id, member_id, employee_name, customer_name,
          service_type, service_type_id, work_date, minutes, customer_hourly_rate,
          customer_charge, hourly_rate, earnings, note, created_at
        FROM public.service_sessions
        WHERE card_id IS NOT NULL
          AND work_date >= ${startDate}::date
          AND work_date < ${endDate}::date
        ON CONFLICT (source_session_id) DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM inserted
    `);

    const deletedSessions = await tx.execute(sql`
      WITH deleted AS (
        DELETE FROM public.service_sessions
        WHERE work_date >= ${startDate}::date
          AND work_date < ${endDate}::date
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted
    `);
    const deletedAttendance = await tx.execute(sql`
      WITH deleted AS (
        DELETE FROM public.attendance
        WHERE work_date >= ${startDate}::date
          AND work_date < ${endDate}::date
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted
    `);
    return {
      year,
      deletedAttendance: Number(deletedAttendance.rows[0]?.count ?? 0),
      deletedServiceSessions: Number(deletedSessions.rows[0]?.count ?? 0),
      archivedCardUses: Number(archived.rows[0]?.count ?? 0),
    };
  });
}

export type RetentionDateRange = {
  fromDate: string;
  toDate: string;
};

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateRetentionDateRange(range: RetentionDateRange): RetentionDateRange {
  if (!isCalendarDate(range.fromDate) || !isCalendarDate(range.toDate)) {
    throw new MassageError(400, "Ngày cần dùng định dạng YYYY-MM-DD hợp lệ.");
  }
  if (range.fromDate > range.toDate) {
    throw new MassageError(400, "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.");
  }
  return range;
}

export function isWithinRetentionDateRange(workDate: string, range: RetentionDateRange): boolean {
  return workDate >= range.fromDate && workDate <= range.toDate;
}

type AttendanceHistoryRow = Pick<typeof attendanceTable.$inferSelect, "id" | "workDate">;
type ServiceHistoryRow = Pick<
  typeof serviceSessionsTable.$inferSelect,
  | "id"
  | "cardId"
  | "memberId"
  | "employeeName"
  | "customerName"
  | "serviceType"
  | "serviceTypeId"
  | "workDate"
  | "minutes"
  | "customerHourlyRate"
  | "customerCharge"
  | "hourlyRate"
  | "earnings"
  | "note"
  | "createdAt"
>;
type ArchivedCardUseRow = Pick<typeof cardUsageHistoryTable.$inferSelect, "sourceSessionId">;

export function buildPartitionedHistoryDeleteMutations(
  attendanceRows: readonly AttendanceHistoryRow[],
  sessionRows: readonly ServiceHistoryRow[],
  historyRows: readonly ArchivedCardUseRow[],
  range: RetentionDateRange,
) {
  const attendance = attendanceRows.filter((row) => isWithinRetentionDateRange(row.workDate, range));
  const sessions = sessionRows.filter((row) => isWithinRetentionDateRange(row.workDate, range));
  const archivedSourceIds = new Set(historyRows.map((row) => row.sourceSessionId));
  const cardUsesToArchive = sessions.filter(
    (row) => row.cardId !== null && !archivedSourceIds.has(row.id),
  );
  const mutations = [
    ...cardUsesToArchive.map((row) => upsertMutation("card_usage_history", row.id, {
      sourceSessionId: row.id,
      cardId: row.cardId!,
      memberId: row.memberId,
      employeeName: row.employeeName,
      customerName: row.customerName,
      serviceType: row.serviceType,
      serviceTypeId: row.serviceTypeId,
      workDate: row.workDate,
      minutes: row.minutes,
      customerHourlyRate: row.customerHourlyRate,
      customerCharge: row.customerCharge,
      hourlyRate: row.hourlyRate,
      earnings: row.earnings,
      note: row.note,
      createdAt: row.createdAt,
    })),
    ...sessions.map((row) => deleteMutation("service_sessions", row.id)),
    ...attendance.map((row) => deleteMutation("attendance", row.id)),
  ];
  return {
    mutations,
    deletedAttendance: attendance.length,
    deletedServiceSessions: sessions.length,
    archivedCardUses: cardUsesToArchive.length,
  };
}

/**
 * Count only the selected date range. The work_date indexes keep the preview
 * from scanning unrelated history; the response contains counts, not records.
 */
export async function previewFacilityHistoryDateRange(input: RetentionDateRange) {
  const { fromDate, toDate } = validateRetentionDateRange(input);
  if (isPartitionedStorageEnabled()) {
    const [attendanceRaw, sessionsRaw] = await Promise.all([
      readPartitionedTable("attendance"),
      readPartitionedTable("service_sessions"),
    ]);
    const attendance = (attendanceRaw as unknown as (typeof attendanceTable.$inferSelect)[])
      .filter((row) => isWithinRetentionDateRange(row.workDate, { fromDate, toDate }));
    const sessions = (sessionsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[])
      .filter((row) => isWithinRetentionDateRange(row.workDate, { fromDate, toDate }));
    return {
      fromDate,
      toDate,
      attendanceCount: attendance.length,
      serviceSessionCount: sessions.length,
      cardUseCount: sessions.filter((row) => row.cardId !== null).length,
    };
  }

  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM public.attendance
        WHERE work_date >= ${fromDate}::date AND work_date <= ${toDate}::date) AS "attendanceCount",
      sessions.service_session_count AS "serviceSessionCount",
      sessions.card_use_count AS "cardUseCount"
    FROM (
      SELECT
        count(*)::int AS service_session_count,
        count(*) FILTER (WHERE card_id IS NOT NULL)::int AS card_use_count
      FROM public.service_sessions
      WHERE work_date >= ${fromDate}::date AND work_date <= ${toDate}::date
    ) AS sessions
  `);
  const row = result.rows[0] as Record<string, unknown>;
  return {
    fromDate,
    toDate,
    attendanceCount: Number(row.attendanceCount ?? 0),
    serviceSessionCount: Number(row.serviceSessionCount ?? 0),
    cardUseCount: Number(row.cardUseCount ?? 0),
  };
}

/**
 * Delete only facility attendance and service sessions in an inclusive date
 * range. Card-use snapshots are inserted first in the same transaction, so
 * card balances never change and the permanent usage ledger remains intact.
 */
export async function deleteFacilityHistoryDateRange(input: RetentionDateRange) {
  const { fromDate, toDate } = validateRetentionDateRange(input);
  if (isPartitionedStorageEnabled()) {
    const [attendanceRaw, sessionsRaw, historyRaw] = await Promise.all([
      readPartitionedTable("attendance"),
      readPartitionedTable("service_sessions"),
      readPartitionedTable("card_usage_history"),
    ]);
    const history = historyRaw as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
    const deletion = buildPartitionedHistoryDeleteMutations(
      attendanceRaw as unknown as AttendanceHistoryRow[],
      sessionsRaw as unknown as ServiceHistoryRow[],
      history,
      { fromDate, toDate },
    );
    if (deletion.mutations.length > 0) {
      await commitPartitionedMutations({
        operationId: randomUUID(),
        lockName: "retention",
        action: "retention.manual-delete-range",
        request: { fromDate, toDate },
        expectedEventCount: deletion.mutations.length,
        build: () => deletion.mutations,
      });
    }
    return {
      fromDate,
      toDate,
      deletedAttendance: deletion.deletedAttendance,
      deletedServiceSessions: deletion.deletedServiceSessions,
      archivedCardUses: deletion.archivedCardUses,
    };
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '15s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended('so-cong:history-retention', 0))
    `);

    const archived = await tx.execute(sql`
      WITH inserted AS (
        INSERT INTO public.card_usage_history (
          source_session_id, card_id, member_id, employee_name, customer_name,
          service_type, service_type_id, work_date, minutes, customer_hourly_rate,
          customer_charge, hourly_rate, earnings, note, created_at
        )
        SELECT
          id, card_id, member_id, employee_name, customer_name,
          service_type, service_type_id, work_date, minutes, customer_hourly_rate,
          customer_charge, hourly_rate, earnings, note, created_at
        FROM public.service_sessions
        WHERE card_id IS NOT NULL
          AND work_date >= ${fromDate}::date
          AND work_date <= ${toDate}::date
        ON CONFLICT (source_session_id) DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM inserted
    `);
    const deletedSessions = await tx.execute(sql`
      WITH deleted AS (
        DELETE FROM public.service_sessions
        WHERE work_date >= ${fromDate}::date
          AND work_date <= ${toDate}::date
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted
    `);
    const deletedAttendance = await tx.execute(sql`
      WITH deleted AS (
        DELETE FROM public.attendance
        WHERE work_date >= ${fromDate}::date
          AND work_date <= ${toDate}::date
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted
    `);

    return {
      fromDate,
      toDate,
      deletedAttendance: Number(deletedAttendance.rows[0]?.count ?? 0),
      deletedServiceSessions: Number(deletedSessions.rows[0]?.count ?? 0),
      archivedCardUses: Number(archived.rows[0]?.count ?? 0),
    };
  });
}

/**
 * Remove employee/personal work records older than five years. Card-linked
 * visits are copied to the permanent card ledger first, in the same transaction,
 * so the redeemed minutes remain consumed and the card history remains complete.
 */
export async function cleanupExpiredHistory() {
  const cutoff = retentionCutoffDate();
  if (isPartitionedStorageEnabled()) {
    const [attendanceRaw, sessionsRaw, archivedRaw, personalRaw] = await Promise.all([
      readPartitionedTable("attendance"),
      readPartitionedTable("service_sessions"),
      readPartitionedTable("card_usage_history"),
      readPartitionedTable("personal_sessions"),
    ]);
    const attendance = (attendanceRaw as unknown as (typeof attendanceTable.$inferSelect)[])
      .filter((row) => row.workDate < cutoff);
    const sessions = (sessionsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[])
      .filter((row) => row.workDate < cutoff);
    const archived = archivedRaw as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
    const archivedIds = new Set(archived.map((row) => row.sourceSessionId));
    const cardUses = sessions.filter((row) => row.cardId !== null && !archivedIds.has(row.id));
    const personalSessions = (personalRaw as unknown as (typeof personalSessionsTable.$inferSelect)[])
      .filter((row) => row.workDate < cutoff);
    const mutations = [
      ...cardUses.map((row) => upsertMutation("card_usage_history", row.id, {
        sourceSessionId: row.id,
        cardId: row.cardId!,
        memberId: row.memberId,
        employeeName: row.employeeName,
        customerName: row.customerName,
        serviceType: row.serviceType,
        serviceTypeId: row.serviceTypeId,
        workDate: row.workDate,
        minutes: row.minutes,
        customerHourlyRate: row.customerHourlyRate,
        customerCharge: row.customerCharge,
        hourlyRate: row.hourlyRate,
        earnings: row.earnings,
        note: row.note,
        createdAt: row.createdAt,
      })),
      ...sessions.map((row) => deleteMutation("service_sessions", row.id)),
      ...attendance.map((row) => deleteMutation("attendance", row.id)),
      ...personalSessions.map((row) => deleteMutation("personal_sessions", row.id)),
    ];
    if (mutations.length) {
      await commitPartitionedMutations({
        operationId: randomUUID(),
        lockName: "retention",
        action: "retention.cleanup",
        request: { cutoff },
        expectedEventCount: mutations.length,
        build: () => mutations,
      });
    }
    return {
      cutoffDate: cutoff,
      archivedCardUses: cardUses.length,
      deletedServiceSessions: sessions.length,
      deletedAttendance: attendance.length,
      deletedPersonalSessions: personalSessions.length,
    };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '15s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('so-cong:history-retention', 0))`);

    const archived = await tx.execute(sql`
      INSERT INTO public.card_usage_history (
        source_session_id, card_id, member_id, employee_name, customer_name,
        service_type, service_type_id, work_date, minutes, customer_hourly_rate,
        customer_charge, hourly_rate, earnings, note, created_at
      )
      SELECT
        id, card_id, member_id, employee_name, customer_name,
        service_type, service_type_id, work_date, minutes, customer_hourly_rate,
        customer_charge, hourly_rate, earnings, note, created_at
      FROM public.service_sessions
      WHERE card_id IS NOT NULL AND work_date < ${cutoff}::date
      ON CONFLICT (source_session_id) DO NOTHING
      RETURNING source_session_id
    `);

    const deletedSessions = await tx.execute(sql`
      DELETE FROM public.service_sessions
      WHERE work_date < ${cutoff}::date
      RETURNING id
    `);
    const deletedAttendance = await tx.execute(sql`
      DELETE FROM public.attendance
      WHERE work_date < ${cutoff}::date
      RETURNING id
    `);
    const deletedPersonalSessions = await tx.execute(sql`
      DELETE FROM public.personal_sessions
      WHERE work_date < ${cutoff}::date
      RETURNING id
    `);

    return {
      cutoffDate: cutoff,
      archivedCardUses: archived.rows.length,
      deletedServiceSessions: deletedSessions.rows.length,
      deletedAttendance: deletedAttendance.rows.length,
      deletedPersonalSessions: deletedPersonalSessions.rows.length,
    };
  });
}
