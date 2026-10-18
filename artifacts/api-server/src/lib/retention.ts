import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { retentionCutoffDate } from "./retention-window";

export type RetentionYearSummary = {
  year: number;
  attendanceCount: number;
  serviceSessionCount: number;
  cardUseCount: number;
};

export async function listFacilityHistoryYears(): Promise<RetentionYearSummary[]> {
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

export async function deleteFacilityHistoryYear(year: number) {
  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;

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
