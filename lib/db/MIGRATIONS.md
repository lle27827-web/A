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

`0012_api_write_operations` is an idempotent additive migration for the
request-idempotency table and manager-grant ownership column. Vercel compatibility
scripts also apply this schema to existing stores without writing migration
baseline history. The migration catalog includes the new application table.

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

The Vercel API build runs `migrate:all-vercel-stores`, then the read-only
`migrate:verify-stores`, then the API build. The migration command preflights the
runtime store configuration and all three distinct direct Neon URLs before
opening database connections. It then applies the existing idempotent
compatibility updates sequentially in DB1, DB2, DB3 order. A completely
empty database is initialized with the reviewed append-only migration sequence.
A partially populated schema is not baselined or reset; verification fails the
build if required tables/columns are absent. Migration steps are not a
distributed transaction: if a later step fails, earlier successful schema
changes remain, and Vercel skips verification and the API build. Correct the
reported environment/schema issue and rerun the build; do not reset or baseline
a populated database to recover. These commands do not migrate the failover
control table, whose migration remains explicit and must be run before deploying
code that requires its recovery fields. The retention-index step uses the single
`DATABASE_URL` target supplied by each loop iteration; it must not re-resolve
all store variables inside the per-store migration.

The build migration requires direct endpoint values for DB1 through DB3. It
prefers `NEON_DB1_DIRECT_URL`, `NEON_DB2_DIRECT_URL`, and
`NEON_DB3_DIRECT_URL`; legacy aliases such as `DATABASE_URL_1_DIRECT`,
`DATABASE_URL_2_DIRECT`, `DATABASE_URL_DIRECT`, `NEON_SOURCE_DIRECT_URL`, and
`MIGRATE_DATABASE_URL_3_DIRECT` are also accepted. If a dedicated direct
variable is absent, it can use the corresponding runtime variable
(`DATABASE_URL_1`, `DATABASE_URL_2`, or `DATABASE_URL_3`) only when it is a
PostgreSQL URL whose host is not a `-pooler` endpoint. Validation errors identify the selected
variable name but never print its value. Preview builds run the same migration
sequence, so they must use isolated Preview databases rather than Production
endpoints.
Do not replace the Vercel compatibility path with general `migrate` on a
populated database until that Vercel target has been audited and its baseline
explicitly authorized and recorded.

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
For the three-node failover chain, run it with `DATABASE_URL_2` set to the Vercel
control database (the existing second node) **using its direct endpoint**, not
the Replit database. It updates the state table's allowed backend values and
adds idempotent interrupted-switch recovery fields; the runtime refuses
promotion to a new node until the schema accepts that node. Existing stale
`switching` rows without source/target metadata are marked for manual review and
remain write-locked.
Do not add `migrate:database-failover-state` to a Vercel build hook. This is a
separate, explicit migration; the automatic three-store schema pipeline described
above does not apply it.

### Three-store cutover and DB4 retirement

The user selected DB1 for facility attendance, DB2 for cards/history, and DB3
for remaining data, business identity, and partition coordination. DB4 is a
temporary migration source, not a runtime store. Do not deploy the three-store
runtime or remove DB4 environment variables until the copy and verification
below have succeeded.

First prepare the DB1–DB3 schema, including the DB3 coordinator tables. Then
pause application writes and run the explicit DB4→DB3 additive copy:

```sh
pnpm --filter @workspace/db run migrate:all-vercel-stores
pnpm --filter @workspace/db run migrate:storage-partitioning
CONFIRM_DB4_TO_DB3_MIGRATION=I_HAVE_PAUSED_WRITES \
pnpm --filter @workspace/db run migrate:db4-to-db3
```

Set `NEON_DB4_DIRECT_URL` (or a supported DB4 direct alias) and the DB1–DB3
direct/runtime URLs in the migration environment. The copy verifies matching
schemas and primary keys, locks the source and destination tables, copies
business, application, journal, and coordinator rows without deleting DB4,
and stops on conflicting rows or unfinished operations. It remaps active
coordinator references from DB4 to DB3 but preserves historical event keys.
If schema comparison or row comparison fails, resolve the discrepancy before
retrying; never overwrite the conflicting row. Keep DB4 available as a rollback
source until the three-store deployment is confirmed.

Only after the script completes, the read-only store verifier passes, and the
deployed app reads the migrated business and partition data should DB4 variables
be removed from Vercel. Deleting the Neon database itself is a separate manual
action and must wait until no replication subscription or other consumer uses it.

### Independent failover coordinator

For failover to remain coordinatable when DB2 (`DATABASE_URL_2`) is unavailable,
provision a separate PostgreSQL database that is not one of the three data
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
a coordinator that is one of the three application data stores. After the
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

## Partitioned storage foundation (not a production cutover)

The storage-partition migration creates only the append-only event journal on
DB1–DB3 and the operation/routing/ID coordinator tables on DB3. It reads the
maximum historical IDs across DB1–DB3 to seed global numeric ID allocators, but it
does not copy, update, or delete business rows. It requires direct Neon URLs for
all three distinct projects:

```sh
pnpm --filter @workspace/db run migrate:storage-partitioning
```

The script prefers `NEON_DB1_DIRECT_URL` through `NEON_DB3_DIRECT_URL` and
supports the legacy DB2/DB3 aliases `DATABASE_URL_2_DIRECT`,
`NEON_SOURCE_DIRECT_URL`, and `MIGRATE_DATABASE_URL_3_DIRECT`. It falls
back to the corresponding `DATABASE_URL_1`, `DATABASE_URL_2`, and
`DATABASE_URL_3` values. It refuses pooler endpoints and repeated Neon
hosts. A missing historical table or an exhausted integer ID range stops before
creating any partition schema.

Applying this migration alone does **not** activate partitioned storage. Do not
set `DATABASE_STORAGE_MODE=partitioned`, stop logical replication, or deploy a
cutover until every API read/write path uses the partition repository, card
operations have idempotent recovery tests, and a full read/revenue parity check
has passed. DB1 remains the canonical source for pre-cutover rows; old copies on
DB2–DB3 must be preserved but excluded from canonical reads to avoid duplicates.
