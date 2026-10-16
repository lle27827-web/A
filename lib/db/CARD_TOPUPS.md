# Card top-up schema update

Run `pnpm --filter @workspace/db run migrate:card-topups` with the intended database
configured through `DATABASE_URL`. This update only adds the top-up history table,
its constraints and indexes. It is transactional and safe to rerun.

The root Vercel configuration runs this update before building the API service.
Deploy the latest source for the feature and migration to take effect there.
The database role used for the build needs permission to create tables and indexes.

Original card purchase amounts/dates stay unchanged. New top-ups are separate
dated transactions; past unrecorded top-ups cannot be reconstructed.

Some existing databases have populated tables but an empty Drizzle migration
journal. The general `migrate` command then tries to replay the initial schema.
The targeted update avoids replaying it and does not invent a baseline or reset
data. For verified baseline reconciliation and safe general upgrades, see
[MIGRATIONS.md](./MIGRATIONS.md). General `migrate` now refuses an unbaselined
populated database instead of trying to recreate its tables.
