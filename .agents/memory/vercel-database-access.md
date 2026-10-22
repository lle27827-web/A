---
name: Vercel database access
description: Replit PostgreSQL connectivity from deployments outside Replit
---

Replit-managed PostgreSQL is not externally accessible from Vercel; its injected `DATABASE_URL` only works inside Replit. A Vercel deployment must use a separate externally reachable PostgreSQL database, such as Neon, configured as Vercel's `DATABASE_URL`.

**Why:** Replit's official database documentation confirms that Replit-managed PostgreSQL does not provide an external connection URL for Vercel or other non-Replit apps.

**How to apply:** For Vercel, provision an external PostgreSQL database, apply the app schema, and configure its URL in Vercel's environment settings. Copy existing data separately if needed. Never put the database URL in source control or chat.

The user chose two copies per new data segment. A write must persist the complete event set to two distinct stores before acknowledging it; readers can use any healthy base copy and need at least three readable event stores to tolerate one store outage. Keep DB4 as the write coordinator and single point of failure for new writes.

**Why:** the user chose two copies per data segment to preserve full reads if one store is unavailable, while using less capacity than four full replicas.

**How to apply:** Use a per-event commit marker so incomplete writes remain hidden. Before activating partition routing, compare all four stores read-only, apply the additive event schema, verify Neon capacity-monitoring configuration on every store, deploy the matching runtime, then explicitly enable partition mode. Do not claim one-store write availability while DB4 remains the sole coordinator.

On 2026-10-22, after read-only hashes and schemas matched across all 14 business tables on DB1–DB4, the additive partition journal/coordinator schema was applied to all four production stores. DB4 starts routing from DB1 and has 12 initialized ID counters; the migration copied, changed, and deleted no business rows. This did not deploy or enable partition mode.

**Why:** the user approved the schema migration only after a fresh all-store parity check, while keeping the application cutover separate.

**How to apply:** Before cutover, recheck data parity and capacity-monitoring project IDs on Vercel, deploy the matching runtime, and obtain separate authorization to enable partition mode.

The four Neon stores are ordered DB1=`DATABASE_URL_1`, DB2=`DATABASE_URL`, DB3=`DATABASE_URL_3`, DB4=`DATABASE_URL_4`. DB4 is the chosen routing coordinator; the user accepts it as a single point of failure.

**Why:** the user explicitly selected DB4 rather than creating a fifth database.

**How to apply:** Store the routing cursor and idempotent operation coordination on DB4; if DB4 is unavailable or full, stop new routed writes rather than guessing a shard or risking conflicting operations.

The live logical replication topology is directional: DB1 → DB2 → DB3 → DB4. DB1's reverse subscription from DB2 is disabled. Treat DB1 as the canonical source; do not directly delete rows on downstream subscribers while replication is active.

**Why:** direct subscriber deletes can conflict with pending upstream changes or allow data to reappear; the live topology is not bidirectional.

**How to apply:** For an authorized full purge, pause application writes, verify the active subscription chain and matching row counts, delete only on DB1 in a foreign-key-safe transaction, then wait for and verify the same result on DB2–DB4. Preserve the subscriptions and explicitly verify any tables that must remain.

The user confirmed all four database URLs, Neon project IDs/API setup, and that DB3/DB4 pooling is disabled. Capacity checking is request-triggered, with 1 GB and 100 CU-hour thresholds, and previously cached successful checks for 30 seconds.

**Why:** these are the user's confirmed production topology and monitoring limits.

**How to apply:** Check each candidate's capacity before routing; keep capacity uncertainty fail-closed. Neon usage metrics may lag, so do not promise an exact-instant transition at the provider limit.

All four production Neon stores have PostgreSQL's default TOAST compression set to LZ4. This changes compression for future TOAST values; it does not rewrite existing rows.

**Why:** the user requested storage savings while preserving ordinary reads, and the four stores were verified to support LZ4.

**How to apply:** Keep this setting on all four stores and do not claim existing data has been compacted; verify the default after reconnecting sessions.

Do not replay a failed database write automatically after an ambiguous connection loss. The database may have committed before the response was lost.

**Why:** retrying blindly can duplicate card use, appointments, or attendance.

**How to apply:** Use persistent idempotency keys and a recoverable operation journal for cross-store sagas; verify operation outcome before retrying.

Keep the retention cleanup schedule disabled until the permanent card-use ledger exists on both Neon databases and the publication/subscription reports that table ready. The runtime failover guard checks publication, subscription, and table counts, but that code check does not confirm live Neon configuration.

**Why:** Cleanup removes old employee sessions after archiving card use; a replica without the ledger could hide that permanent history after failover.

**How to apply:** Re-enable the Vercel cron only after read-only checks confirm `card_usage_history` is published and its subscription relation is ready on the fallback.

The production CU probe must be owner-triggered and bounded: no more than 60 short transactions, spaced at least 31 seconds apart, each inserting and deleting its probe appointment within the same transaction. It may confirm that a real threshold-triggered switch occurs, but it must not claim to consume 100 CU-hours on demand.

**Why:** CU-hours are real provider usage, so an unbounded load loop can create unexpected cost; short transactions are reversible but may not move usage to the threshold.

**How to apply:** Keep the endpoint production-only and owner-authorized, stop on a backend change or any error, and explain that a run can finish without reaching 100 CU-hours.

The user asked to remove the database-switching/status lines from the Settings UI; this removes the visible manual failover and CU-probe entry points, not the backend's automatic routing logic or database data.

**Why:** the request was to clean up the displayed controls without asking to disable automatic storage routing or alter the four stores.

**How to apply:** Keep database status/probe dialogs out of Settings unless the user explicitly asks to restore them; do not change production routing or storage state as part of UI cleanup.
