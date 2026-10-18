import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { retentionCutoffDate } from "./retention-window";

const testDatabaseUrl = process.env.RETENTION_TEST_DATABASE_URL;

test("retention archives card use atomically and never refunds used minutes", {
  skip: !testDatabaseUrl,
}, async () => {
  const connection = new URL(testDatabaseUrl!);
  if (!["localhost", "127.0.0.1", "::1"].includes(connection.hostname)) {
    throw new Error("RETENTION_TEST_DATABASE_URL must point to a local isolated database.");
  }

  process.env.DATABASE_URL = testDatabaseUrl!;
  process.env.VERCEL = "";
  delete process.env.DATABASE_URL_1;
  delete process.env.DATABASE_URL_1_MAX_BYTES;
  delete process.env.NEON_DB1_DIRECT_URL;
  delete process.env.NEON_SOURCE_DIRECT_URL;

  const [{ db, pool }, { cleanupExpiredHistory, deleteFacilityHistoryYear, listFacilityHistoryYears }] = await Promise.all([
    import("@workspace/db"),
    import("./retention"),
  ]);
  const setupPool = pool;

  try {
    await setupPool.query(`
      DROP TABLE IF EXISTS public.card_usage_history, public.service_sessions,
        public.attendance, public.personal_sessions, public.treatment_cards CASCADE;
      CREATE TABLE public.treatment_cards (
        id integer PRIMARY KEY,
        total_minutes integer NOT NULL
      );
      CREATE TABLE public.service_sessions (
        id serial PRIMARY KEY,
        card_id integer,
        member_id integer,
        employee_name text NOT NULL,
        customer_name text NOT NULL DEFAULT '',
        service_type text NOT NULL,
        service_type_id integer,
        work_date date NOT NULL,
        minutes integer NOT NULL,
        customer_hourly_rate integer NOT NULL DEFAULT 0,
        customer_charge integer NOT NULL DEFAULT 0,
        hourly_rate integer NOT NULL,
        earnings integer NOT NULL,
        note text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.attendance (
        id serial PRIMARY KEY,
        work_date date NOT NULL
      );
      CREATE TABLE public.personal_sessions (
        id serial PRIMARY KEY,
        work_date date NOT NULL
      );
    `);

    const migrationPath = resolve(process.cwd(), "../../lib/db/drizzle/0011_card_usage_history.sql");
    const migration = await readFile(migrationPath, "utf8");
    for (const statement of migration.split("--> statement-breakpoint").filter((part) => part.trim())) {
      await setupPool.query(statement);
    }

    const cutoff = retentionCutoffDate();
    const cutoffYear = Number(cutoff.slice(0, 4));
    const otherYear = cutoffYear + 1;
    const beforeCutoff = new Date(`${cutoff}T00:00:00.000Z`);
    beforeCutoff.setUTCDate(beforeCutoff.getUTCDate() - 1);
    const oldDate = beforeCutoff.toISOString().slice(0, 10);
    await setupPool.query("INSERT INTO public.treatment_cards (id, total_minutes) VALUES (1, 120)");

    const insertSession = async (
      cardId: number | null,
      workDate: string,
      minutes: number,
      note: string,
    ) => {
      const result = await setupPool.query(`
        INSERT INTO public.service_sessions (
          card_id, member_id, employee_name, customer_name, service_type,
          work_date, minutes, customer_hourly_rate, customer_charge,
          hourly_rate, earnings, note
        ) VALUES ($1, 7, 'Technician Snapshot', 'Customer Snapshot', 'Massage',
          $2, $3, 80000, 40000, 30000, 15000, $4)
        RETURNING id
      `, [cardId, workDate, minutes, note]);
      return Number(result.rows[0].id);
    };
    const oldCardUseId = await insertSession(1, oldDate, 30, "keep card note");
    await insertSession(null, oldDate, 60, "old walk-in");
    await insertSession(1, cutoff, 15, "retained card use");
    await insertSession(null, cutoff, 20, "retained walk-in");
    await insertSession(1, `${otherYear}-06-01`, 10, "other year card use");
    await insertSession(null, `${otherYear}-06-01`, 5, "other year walk-in");
    await setupPool.query("INSERT INTO public.attendance (work_date) VALUES ($1), ($2), ($3)", [oldDate, cutoff, `${otherYear}-06-01`]);
    await setupPool.query("INSERT INTO public.personal_sessions (work_date) VALUES ($1), ($2), ($3)", [oldDate, cutoff, `${otherYear}-06-01`]);

    await setupPool.query(`
      CREATE FUNCTION public.fail_retention_session_delete() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'intentional isolated rollback test'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_retention_session_delete
        BEFORE DELETE ON public.service_sessions
        FOR EACH ROW EXECUTE FUNCTION public.fail_retention_session_delete();
    `);
    await assert.rejects(cleanupExpiredHistory(), (error: unknown) => {
      const cause = error instanceof Error ? error.cause : undefined;
      return cause instanceof Error && cause.message.includes("intentional isolated rollback test");
    });
    assert.equal(Number((await setupPool.query("SELECT count(*) AS count FROM public.card_usage_history")).rows[0].count), 0);
    assert.equal(Number((await setupPool.query("SELECT count(*) AS count FROM public.service_sessions")).rows[0].count), 6);
    await setupPool.query(`
      DROP TRIGGER fail_retention_session_delete ON public.service_sessions;
      DROP FUNCTION public.fail_retention_session_delete();
    `);

    const result = await cleanupExpiredHistory();
    assert.deepEqual(result, {
      cutoffDate: cutoff,
      archivedCardUses: 1,
      deletedServiceSessions: 2,
      deletedAttendance: 1,
      deletedPersonalSessions: 1,
    });

    const archived = await setupPool.query(`
      SELECT source_session_id, card_id, member_id, employee_name, customer_name,
        service_type, work_date::text, minutes, customer_charge, earnings, note
      FROM public.card_usage_history
    `);
    assert.deepEqual(archived.rows[0], {
      source_session_id: oldCardUseId,
      card_id: 1,
      member_id: 7,
      employee_name: "Technician Snapshot",
      customer_name: "Customer Snapshot",
      service_type: "Massage",
      work_date: oldDate,
      minutes: 30,
      customer_charge: 40000,
      earnings: 15000,
      note: "keep card note",
    });
    const balance = await setupPool.query(`
      SELECT total_minutes
        - (SELECT coalesce(sum(minutes), 0) FROM public.card_usage_history WHERE card_id = 1)
        - (SELECT coalesce(sum(minutes), 0) FROM public.service_sessions WHERE card_id = 1)
        AS remaining
      FROM public.treatment_cards WHERE id = 1
    `);
    assert.equal(Number(balance.rows[0].remaining), 65);

    const rerun = await cleanupExpiredHistory();
    assert.deepEqual(rerun, {
      cutoffDate: cutoff,
      archivedCardUses: 0,
      deletedServiceSessions: 0,
      deletedAttendance: 0,
      deletedPersonalSessions: 0,
    });

    assert.deepEqual(await listFacilityHistoryYears(), [
      { year: otherYear, attendanceCount: 1, serviceSessionCount: 2, cardUseCount: 1 },
      { year: cutoffYear, attendanceCount: 1, serviceSessionCount: 2, cardUseCount: 1 },
    ]);

    const deletedYear = await deleteFacilityHistoryYear(cutoffYear);
    assert.deepEqual(deletedYear, {
      year: cutoffYear,
      deletedAttendance: 1,
      deletedServiceSessions: 2,
      archivedCardUses: 1,
    });
    assert.equal(Number((await setupPool.query("SELECT count(*) AS count FROM public.personal_sessions")).rows[0].count), 2);
    assert.equal(Number((await setupPool.query("SELECT count(*) AS count FROM public.service_sessions")).rows[0].count), 2);
    assert.equal(Number((await setupPool.query("SELECT count(*) AS count FROM public.card_usage_history")).rows[0].count), 2);
    assert.equal(Number((await setupPool.query(
      "SELECT count(*) AS count FROM public.attendance WHERE extract(year FROM work_date) = $1",
      [otherYear],
    )).rows[0].count), 1);

    const balanceAfterYearDelete = await setupPool.query(`
      SELECT total_minutes
        - (SELECT coalesce(sum(minutes), 0) FROM public.card_usage_history WHERE card_id = 1)
        - (SELECT coalesce(sum(minutes), 0) FROM public.service_sessions WHERE card_id = 1)
        AS remaining
      FROM public.treatment_cards WHERE id = 1
    `);
    assert.equal(Number(balanceAfterYearDelete.rows[0].remaining), 65);
    assert.deepEqual(await listFacilityHistoryYears(), [
      { year: otherYear, attendanceCount: 1, serviceSessionCount: 2, cardUseCount: 1 },
    ]);
  } finally {
    await pool.end();
  }
});
