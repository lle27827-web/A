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

export async function deleteFacilityHistoryYear(year: number, operationId?: string) {
  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;

  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi xóa lịch sử.");
    const [attendanceRaw, sessionsRaw, archivedRaw] = await Promise.all([
      readPartitionedTable("attendance"),
      readPartitionedTable("service_sessions"),
      readPartitionedTable("card_usage_history"),
    ]);
    const attendance = (attendanceRaw as unknown as (typeof attendanceTable.$inferSelect)[])
      .filter((row) => row.workDate >= startDate && row.workDate < endDate);
    const sessions = (sessionsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[])
      .filter((row) => row.workDate >= startDate && row.workDate < endDate);
    const archived = archivedRaw as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
    const archivedIds = new Set(archived.map((row) => row.sourceSessionId));
    const cardUses = sessions.filter((row) => row.cardId !== null && !archivedIds.has(row.id));
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
    ];
    if (mutations.length) {
      await commitPartitionedMutations({
        operationId,
        lockName: "retention",
        action: "retention.delete-year",
        request: { year },
        expectedEventCount: mutations.length,
        build: () => mutations,
      });
    }
    return {
      year,
      deletedAttendance: attendance.length,
      deletedServiceSessions: sessions.length,
      archivedCardUses: cardUses.length,
    };
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '15s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended('so-cong:history-retention', 0))
    `);

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
      WHERE card_id IS NOT NULL
        AND work_date >= ${startDate}::date
        AND work_date < ${endDate}::date
      ON CONFLICT (source_session_id) DO NOTHING
      RETURNING source_session_id
    `);

    const deletedSessions = await tx.execute(sql`
      DELETE FROM public.service_sessions
      WHERE work_date >= ${startDate}::date
        AND work_date < ${endDate}::date
      RETURNING id
    `);
    const deletedAttendance = await tx.execute(sql`
      DELETE FROM public.attendance
      WHERE work_date >= ${startDate}::date
        AND work_date < ${endDate}::date
      RETURNING id
    `);

    return {
      year,
      deletedAttendance: deletedAttendance.rows.length,
      deletedServiceSessions: deletedSessions.rows.length,
      archivedCardUses: archived.rows.length,
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
