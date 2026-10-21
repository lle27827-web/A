---
name: Vercel database access
description: Replit PostgreSQL connectivity from deployments outside Replit
---

Replit-managed PostgreSQL is not externally accessible from Vercel; its injected `DATABASE_URL` only works inside Replit. A Vercel deployment must use a separate externally reachable PostgreSQL database, such as Neon, configured as Vercel's `DATABASE_URL`.

**Why:** Replit's official database documentation confirms that Replit-managed PostgreSQL does not provide an external connection URL for Vercel or other non-Replit apps.

**How to apply:** For Vercel, provision an external PostgreSQL database, apply the app schema, and configure its URL in Vercel's environment settings. Copy existing data separately if needed. Never put the database URL in source control or chat.

The user now chooses partitioned storage instead of replicated failover: keep historical data in its original store, route new writes to the next store when the current one reaches capacity, and store edits/deletes of old records as append-only changes in the next store. The user accepts cross-store references and multi-step transactions.

**Why:** the user wants each full store's existing data to remain usable without copying it forward, while later writes continue in another store.

**How to apply:** Treat DB1 as the source for pre-partition history, preserve all existing copies during cutover, and do not enable routing until global IDs, cross-store reads, change overlays/tombstones, and card-use transaction recovery are implemented and verified. A simple active-connection switch does not satisfy this design.

The four Neon stores are ordered DB1=`DATABASE_URL_1`, DB2=`DATABASE_URL`, DB3=`DATABASE_URL_3`, DB4=`DATABASE_URL_4`. DB4 is the chosen routing coordinator; the user accepts it as a single point of failure.

**Why:** the user explicitly selected DB4 rather than creating a fifth database.

**How to apply:** Store the routing cursor and idempotent operation coordination on DB4; if DB4 is unavailable or full, stop new routed writes rather than guessing a shard or risking conflicting operations.

The four stores were previously configured as logical replicas. At the last verified coordinator-state copy, DB1 (`database_url_1`) was active. Do not delete replica data when changing models; establish a cutover boundary and treat pre-cutover rows from DB1 as canonical to avoid duplicate history.

**Why:** the user requires historical data to remain and explicitly asked not to move it.

**How to apply:** Disable replication only as part of a controlled cutover after partition-aware reads and writes are ready; do not assume the application already supports partitioning.

The user confirmed all four database URLs, Neon project IDs/API setup, and that DB3/DB4 pooling is disabled. Capacity checking is request-triggered, with 1 GB and 100 CU-hour thresholds, and previously cached successful checks for 30 seconds.

**Why:** these are the user's confirmed production topology and monitoring limits.

**How to apply:** Check each candidate's capacity before routing; keep capacity uncertainty fail-closed. Neon usage metrics may lag, so do not promise an exact-instant transition at the provider limit.

Do not replay a failed database write automatically after an ambiguous connection loss. The database may have committed before the response was lost.

**Why:** retrying blindly can duplicate card use, appointments, or attendance.

**How to apply:** Use persistent idempotency keys and a recoverable operation journal for cross-store sagas; verify operation outcome before retrying.

Keep the retention cleanup schedule disabled until the permanent card-use ledger exists on both Neon databases and the publication/subscription reports that table ready. The runtime failover guard checks publication, subscription, and table counts, but that code check does not confirm live Neon configuration.

**Why:** Cleanup removes old employee sessions after archiving card use; a replica without the ledger could hide that permanent history after failover.

**How to apply:** Re-enable the Vercel cron only after read-only checks confirm `card_usage_history` is published and its subscription relation is ready on the fallback.

The production CU probe must be owner-triggered and bounded: no more than 60 short transactions, spaced at least 31 seconds apart, each inserting and deleting its probe appointment within the same transaction. It may confirm that a real threshold-triggered switch occurs, but it must not claim to consume 100 CU-hours on demand.

**Why:** CU-hours are real provider usage, so an unbounded load loop can create unexpected cost; short transactions are reversible but may not move usage to the threshold.

**How to apply:** Keep the endpoint production-only and owner-authorized, stop on a backend change or any error, and explain that a run can finish without reaching 100 CU-hours.
