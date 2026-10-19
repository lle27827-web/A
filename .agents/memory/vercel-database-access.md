---
name: Vercel database access
description: Replit PostgreSQL connectivity from deployments outside Replit
---

Replit-managed PostgreSQL is not externally accessible from Vercel; its injected `DATABASE_URL` only works inside Replit. A Vercel deployment must use a separate externally reachable PostgreSQL database, such as Neon, configured as Vercel's `DATABASE_URL`.

**Why:** Replit's official database documentation confirms that Replit-managed PostgreSQL does not provide an external connection URL for Vercel or other non-Replit apps.

**How to apply:** For Vercel, provision an external PostgreSQL database, apply the app schema, and configure its URL in Vercel's environment settings. Copy existing data separately if needed. Never put the database URL in source control or chat.

For this app, the existing Vercel data is in one Neon project and `DATABASE_URL_1` is a separate Neon project. Initial data/schema synchronization and ongoing logical replication were verified in both directions. The intended arrangement is `DATABASE_URL_1` as primary and `DATABASE_URL` as fallback.

**Why:** The user confirmed the projects are separate, the current Vercel records are in `DATABASE_URL`, and requested automatic fallback to that database if `DATABASE_URL_1` fills. Switching before synchronization would split writes or hide records.

**How to apply:** Keep both database variables configured in Vercel and do not claim production has switched until the failover-capable code is deployed there. Replit secrets do not automatically configure Vercel. Runtime failover checks run only on API requests (not while idle), use a 1 GB storage threshold by default, and check 100 CU-hours through Neon’s project API using `NEON_API_KEY` and `NEON_PROJECT_ID_1` for the primary `DATABASE_URL_1`. `DATABASE_URL_1_MAX_BYTES` can override the storage threshold. Failover must stop unless the fallback is fully synchronized; Neon’s usage metric may lag.

As of 2026-10-19, the user confirmed Vercel has `DATABASE_URL_3` and `DATABASE_URL_4` configured with pooling disabled, and has configured `NEON_PROJECT_ID_3`, `NEON_PROJECT_ID_4`, and the direct URL overrides discussed for pooled database URLs.

**Why:** The user explicitly confirmed these Vercel settings; they are needed to check candidate CU usage and manage subscriptions safely.

**How to apply:** Recheck the production deployment after environment changes; keep automatic promotion fail-closed until every link in `DATABASE_URL_1` → `DATABASE_URL` → `DATABASE_URL_3` → `DATABASE_URL_4` is synchronized and can be checked for capacity.

Keep the retention cleanup schedule disabled until the permanent card-use ledger exists on both Neon databases and the publication/subscription reports that table ready. The runtime failover guard checks publication, subscription, and table counts, but that code check does not confirm live Neon configuration.

**Why:** Cleanup removes old employee sessions after archiving card use; a replica without the ledger could hide that permanent history after failover.

**How to apply:** Re-enable the Vercel cron only after read-only checks confirm `card_usage_history` is published and its subscription relation is ready on the fallback.
