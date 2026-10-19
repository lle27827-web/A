# Safe migrations and existing-database baselines

All commands use **only `DATABASE_URL`**. They do not select `VERCEL_DATABASE_URL`
automatically, reset tables, or use `push` / `push-force`. Confirm the intended
environment before running a write command. An audit of development is not
authorization to change Vercel production.

## Existing database with application tables and an empty journal

1. Back up the intended database and confirm its environment.
2. Run `pnpm --filter @workspace/db run migrate:audit`.
3. Review `equivalentThrough` and `differences`. Baseline is allowed only when the
   actual schema exactly matches a reviewed historical migration prefix.
4. With authorization for that database, run
   `pnpm --filter @workspace/db run migrate:baseline`.
5. Run `pnpm --filter @workspace/db run migrate`, then `migrate:audit` if the
   resulting schema is within the reviewed baseline range.

Audit compares application tables, column types/lengths/nullability/defaults,
serial sequence definitions and ownership, primary/foreign/check constraints,
constraint validation and actions, indexes and uniqueness/validity, RLS flags,
and user triggers. It ignores unrelated tables and sequence **current values**.
Different object names or extra app-table definitions conservatively stop a
baseline rather than guessing that they are equivalent.

Employee-history and used-card backfills are checked separately from DDL.
Incomplete backfills stop baseline creation; run the corresponding reviewed
targeted update, then audit again. Partial/out-of-order schema updates also stop
the process. Investigate the reported differences; never fill journal rows
manually or run a reset to bypass them.

Baseline records only verified hashes and original journal timestamps. It does
not replay application migrations or alter customer/employee/payment/session
rows. Its changes and any pending migration batch are transactional.

## New database

On a confirmed empty target, run:

```sh
DATABASE_URL='<direct URL for this target>' pnpm --filter @workspace/db run migrate
```

This applies all migrations in order and creates the normal Drizzle journal.
Rerunning is a no-op. A populated database with no baseline is refused before any
application SQL is replayed.

## Future releases

Generate a **new** migration with Drizzle; never edit an existing migration.
Commit its SQL, snapshot and journal metadata. On a database with a valid
contiguous journal, `migrate` applies only pending files, atomically, under a
shared advisory lock. Invalid hashes, missing journal entries or reordered
timestamps stop the command. Append-only future migrations do not require
expanding the historical baseline reference list.

The reference SQL used by baseline/audit is pinned in
`scripts/baseline-reviewed.json` to the reviewed initial/pricing/top-up/employee
history/used-card migrations. It is built in a unique shadow schema inside a
savepoint and rolled back. Only those reviewed files may be executed as audit
fixtures; unreviewed future SQL could contain DML or cross-schema side effects.
Do not regenerate the pinned hashes to conceal edited history. Extending the
baseline range requires reviewing schema references, DML, data-backfill checks
and integration tests first. Auditing a newer, already journaled future schema
may report it as outside the reviewed baseline range; this is **not** a reason
to baseline it again. Its valid existing journal remains authoritative.

All migration commands should go through package scripts, not a concurrent
raw `drizzle-kit migrate`, so they share the lock. Keep migration files
noninteractive and additive where possible. PostgreSQL sequence counters may
advance on rolled-back inserts; gaps in IDs are normal, not lost records.

## Vercel and Replit

The Vercel build keeps its existing additive update commands. They now share
the general migration lock but **do not invent journal history**. Do not replace
that compatibility path with general `migrate` until the **Vercel target** has
been audited and its baseline explicitly authorized and recorded. A brand-new
Vercel database must first be initialized with `migrate` using its confirmed
`DATABASE_URL`; the top-up-only update cannot initialize the base tables.

The facility-wide appointments table and its status field are additive updates.
The Vercel API build runs `migrate:appointments` using the configured
`DATABASE_URL`; it creates the table and date index when absent, and adds a
`scheduled`-by-default status to existing rows. It can safely run again on later
builds. It does not select `VERCEL_DATABASE_URL` or copy data between databases.

The Replit post-merge hook uses safe `migrate`, not schema `push`. An unverified
existing target fails clearly instead of prompting to reshape populated tables.
This is for the workspace development database, not an authorization to migrate
an external production target.

## Vercel database failover state

The `migrate:database-failover-state` command runs only when invoked explicitly.
For the four-node failover chain, run it with `DATABASE_URL` set to the Vercel
control database (the existing second node) **using its direct endpoint**, not
the Replit database. It updates the state table's allowed backend values; the
runtime refuses promotion to a new node until this constraint accepts that node.
Do not add the migration to a Vercel build hook.

### Independent failover coordinator

For failover to remain coordinatable when DB2 (`DATABASE_URL`) is unavailable,
provision a separate PostgreSQL database that is not one of the four data
stores. It stores only the single `public.db_failover_state` coordination row.
The application continues using the legacy DB2 state table until
`DATABASE_FAILOVER_COORDINATOR_URL` is configured.

Before setting that Vercel variable, initialize and seed the separate
coordinator from the current DB2 state using the explicit migration command:

```sh
DATABASE_FAILOVER_COORDINATOR_URL='[new coordinator connection URL]' \
DATABASE_FAILOVER_STATE_SOURCE_URL='[direct DB2 connection URL]' \
pnpm --filter @workspace/db run migrate:database-failover-coordinator
```

The migration only reads the existing state from DB2 and creates/initializes
the state table on the new coordinator. It refuses to overwrite a conflicting
state or migrate while the current state is `switching`. Do not run this against
a coordinator that is one of the four application data stores. After the
migration succeeds, add `DATABASE_FAILOVER_COORDINATOR_URL` to the Vercel
environment and redeploy. If that URL is set before migration, application
database requests fail closed until the coordinator state table is ready.

## Verification

```sh
pnpm --filter @workspace/db run test:migrations
```

Tests create uniquely named schemas in the configured **development** database,
then remove only those test-owned schemas. They cover fresh initialization,
every populated historical prefix, exact baseline equivalence, normal Drizzle
compatibility, preservation of existing rows, wrong defaults/types/nullability/
constraints/indexes/sequence definitions/RLS, incomplete backfills, journal
corruption, append-only upgrades, transactional failures and concurrent baselines.
No application table is reset or deleted.
