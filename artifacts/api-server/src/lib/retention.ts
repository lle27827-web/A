import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { retentionCutoffDate } from "./retention-window";

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
