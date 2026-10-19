---
name: Vercel database access
description: Replit PostgreSQL connectivity from deployments outside Replit
---

Replit-managed PostgreSQL is not externally accessible from Vercel; its injected `DATABASE_URL` only works inside Replit. A Vercel deployment must use a separate externally reachable PostgreSQL database, such as Neon, configured as Vercel's `DATABASE_URL`.

**Why:** Replit's official database documentation confirms that Replit-managed PostgreSQL does not provide an external connection URL for Vercel or other non-Replit apps.

**How to apply:** For Vercel, provision an external PostgreSQL database, apply the app schema, and configure its URL in Vercel's environment settings. Copy existing data separately if needed. Never put the database URL in source control or chat.

For this app, the existing Vercel data is in one Neon project and `DATABASE_URL_1` is a separate Neon project. Initial data/schema synchronization and ongoing logical replication were verified in both directions. The intended arrangement is `DATABASE_URL_1` as primary and `DATABASE_URL` as fallback.

**Why:** The user confirmed the projects are separate, the current Vercel records are in `DATABASE_URL`, and requested automatic fallback to that database if `DATABASE_URL_1` fills. Switching before synchronization would split writes or hide records.

**How to apply:** Keep both database variables configured in Vercel and do not claim production has switched until the failover-capable code is deployed there. Replit secrets do not automatically configure Vercel. Runtime checks run on API requests (not while idle), use a 1 GB storage threshold by default, and check 100 CU-hours through Neon’s project API. Successful checks are cached for 30 seconds; a missing or failed CU/storage check must fail closed and must not cache the failure. Neon’s usage metric may lag, so a reported 100 CU-hours is not a guarantee of switching at the exact instant the limit is consumed.

**Why:** continuing writes after a failed capacity check would silently defeat the CU limit and could lead to an unavailable or full database.

**How to apply:** Require the API key and project ID for every configured Neon node; return 503 when capacity cannot be verified, and retry the check on the next API request.

As of 2026-10-19, the user confirmed Vercel has `DATABASE_URL_3` and `DATABASE_URL_4` configured with pooling disabled, and has configured `NEON_PROJECT_ID_3`, `NEON_PROJECT_ID_4`, and the direct URL overrides discussed for pooled database URLs.

**Why:** The user explicitly confirmed these Vercel settings; they are needed to check candidate CU usage and manage subscriptions safely.

**How to apply:** Recheck the production deployment after environment changes; keep automatic promotion fail-closed until every link in `DATABASE_URL_1` → `DATABASE_URL` → `DATABASE_URL_3` → `DATABASE_URL_4` is synchronized and can be checked for capacity.

The user requires owner-controlled switching in both directions only between adjacent databases, and only after the target is synchronized. Do not allow direct jumps or switch to a stale standby; pause writes and fail closed if replication or rollback cannot be verified.

**Why:** The user chose reversible, stepwise switching; an unsynchronized target can hide newer records or split writes across databases.

**How to apply:** Keep each active replication edge aligned with the current primary. Before every switch, verify the current-to-target stream and capacity; if reverse replication cannot be established and checked, leave the existing database active or keep writes paused.

At any point, replication should flow outward from the single active database along the adjacent chain. Disable the opposite-direction subscription on the active node before treating the chain as healthy.

**Why:** parallel reverse subscriptions can make the write direction ambiguous and block a safe promotion.

**How to apply:** Verify each outward subscription is enabled, ready for every application table, and caught up; verify the opposite subscription is disabled. Rebuild the direction after a controlled failover rather than leaving both directions enabled.

Availability errors may trigger the same guarded adjacent promotion, but the failed SQL operation must never be replayed automatically: a disconnected client may have lost the response after the database committed. The operation's outcome must be verified before any retry.

**Why:** retrying a write after an ambiguous commit can create duplicate attendance, appointments, or card transactions.

**How to apply:** Trigger promotion only for classified infrastructure/availability errors, not ordinary SQL validation failures. Let later requests use the new active database, and tell users to verify the failed operation before resubmitting it.

Runtime coordination can use a separate PostgreSQL database through `DATABASE_FAILOVER_COORDINATOR_URL`; until that coordinator is initialized and configured, the application falls back to the legacy state row on DB2. If the configured coordinator is unavailable, fail closed.

**Why:** all Vercel instances need a shared, writable coordination record to pause writes and prevent split-brain; keeping that record on DB2 prevents safe failover when DB2 is unavailable.

**How to apply:** Initialize the independent coordinator by copying only the current active-backend state from DB2, then configure Vercel to use it. Keep it outside the four data stores; do not migrate the state row to one of those four or enable the new URL before the migration succeeds.

Keep the retention cleanup schedule disabled until the permanent card-use ledger exists on both Neon databases and the publication/subscription reports that table ready. The runtime failover guard checks publication, subscription, and table counts, but that code check does not confirm live Neon configuration.

**Why:** Cleanup removes old employee sessions after archiving card use; a replica without the ledger could hide that permanent history after failover.

**How to apply:** Re-enable the Vercel cron only after read-only checks confirm `card_usage_history` is published and its subscription relation is ready on the fallback.

The production CU probe must be owner-triggered and bounded: no more than 60 short transactions, spaced at least 31 seconds apart, each inserting and deleting its probe appointment within the same transaction. It may confirm that a real threshold-triggered switch occurs, but it must not claim to consume 100 CU-hours on demand.

**Why:** CU-hours are real provider usage, so an unbounded load loop can create unexpected cost; short transactions are reversible but may not move usage to the threshold.

**How to apply:** Keep the endpoint production-only and owner-authorized, stop on a backend change or any error, and explain that a run can finish without reaching 100 CU-hours.
