---
name: Vercel database access
description: Replit PostgreSQL connectivity from deployments outside Replit
---

Replit-managed PostgreSQL is not externally accessible from Vercel; its injected `DATABASE_URL` only works inside Replit. A Vercel deployment must use a separate externally reachable PostgreSQL database, such as Neon, configured as Vercel's `DATABASE_URL`.

**Why:** Replit's official database documentation confirms that Replit-managed PostgreSQL does not provide an external connection URL for Vercel or other non-Replit apps.

**How to apply:** For Vercel, provision an external PostgreSQL database, apply the app schema, and configure its URL in Vercel's environment settings. Copy existing data separately if needed. Never put the database URL in source control or chat.

The user chose two copies per new data segment. A write must persist the complete event set to two distinct stores before acknowledging it; readers can use any healthy base copy and need at least three readable event stores to tolerate one store outage. Keep DB4 as the write coordinator and single point of failure for new writes.

**Why:** the user chose two copies per data segment to preserve full reads if one store is unavailable, while using less capacity than four full replicas.

**How to apply:** Use a per-event commit marker so incomplete writes remain hidden. Before activating partition routing, compare all four stores read-only and apply the additive event schema. Do not claim one-store write availability while DB4 remains the sole coordinator.

On 2026-10-22, after read-only hashes and schemas matched across all 14 business tables on DB1–DB4, the additive partition journal/coordinator schema was applied to all four production stores. DB4 starts routing from DB1 and has 12 initialized ID counters; the migration copied, changed, and deleted no business rows. This did not deploy or enable partition mode.

**Why:** the user approved the schema migration only after a fresh all-store parity check, while keeping the application cutover separate.

**How to apply:** Before cutover, recheck data parity and schemas, deploy the matching runtime, and obtain separate authorization to enable partition mode.

The four Neon stores are DB1=`DATABASE_URL` + `NEON_DB1_DIRECT_URL`, DB2=`DATABASE_URL_1` + `NEON_DB2_DIRECT_URL`, DB3=`DATABASE_URL_3` + `NEON_DB3_DIRECT_URL`, and DB4=`DATABASE_URL_4` + `NEON_DB4_DIRECT_URL`. Keep the runtime URL and direct URL for each label on the same Neon database.

**Why:** the user explicitly switched DB1 and DB2's environment-variable slots while preserving the four logical data partitions.

**How to apply:** `DATABASE_URL` now names DB1, not DB2. Keep backend labels and data-domain assignments stable; do not infer the store from the suffix alone.

DB4 is the chosen routing coordinator; the user accepts it as a single point of failure.

**Why:** the user explicitly selected DB4 rather than creating a fifth database.

**How to apply:** Store the routing cursor and idempotent operation coordination on DB4; if DB4 is unavailable or full, stop new routed writes rather than guessing a shard or risking conflicting operations.

The live logical replication topology is directional: DB1 → DB2 → DB3 → DB4. DB1's reverse subscription from DB2 is disabled. Treat DB1 as the canonical source; do not directly delete rows on downstream subscribers while replication is active.

**Why:** direct subscriber deletes can conflict with pending upstream changes or allow data to reappear; the live topology is not bidirectional.

**How to apply:** For an authorized full purge, pause application writes, verify the active subscription chain and matching row counts, delete only on DB1 in a foreign-key-safe transaction, then wait for and verify the same result on DB2–DB4. Preserve the subscriptions and explicitly verify any tables that must remain.

The user wants all four Neon databases kept in fixed data-domain partitions, but removed the 100 CU-hour/1 GB capacity checks and capacity-triggered routing. When a store is full, the owner will upgrade it; only a genuine connection failure may retry the affected domain write on one alternate two-store pair. Whole-database promotion is disabled because it can mix domains.

**Why:** the user explicitly chose to keep all four partitioned stores and handle capacity by upgrading, not by moving writes when a limit is reached.

**How to apply:** Do not call Neon CU APIs or query database size during ordinary requests. Do not reroute on capacity, I/O, or configuration-limit errors. Keep DB1–DB4 URLs and migration URLs; remove capacity/failover-only environment variables only after the matching code is deployed. Verify Neon logical replication consumers before disabling old subscriptions.

Partitioned reads query three of the four event journals on the healthy path and query the fourth only when needed to replace an unavailable store. The base snapshot is read from the first event-readable store, trying another only if that read fails. Each committed event is copied to two distinct stores, so any three of the four contain at least one copy of every event.

**Why:** reading all four journals and fanning the base query out to every store used extra Neon compute without adding single-store-outage coverage.

**How to apply:** Preserve a minimum of three successful journal reads while each event has two copies. Revisit this coverage proof before changing the replica count or the fallback routing; do not restore all-store base-read fan-out.

All four production Neon stores have PostgreSQL's default TOAST compression set to LZ4. This changes compression for future TOAST values; it does not rewrite existing rows.

**Why:** the user requested storage savings while preserving ordinary reads, and the four stores were verified to support LZ4.

**How to apply:** Keep this setting on all four stores and do not claim existing data has been compacted; verify the default after reconnecting sessions.

Do not replay a failed database write automatically after an ambiguous connection loss. The database may have committed before the response was lost.

**Why:** retrying blindly can duplicate card use, appointments, or attendance.

**How to apply:** Use persistent idempotency keys and a recoverable operation journal for cross-store sagas; verify operation outcome before retrying.

Keep the retention cleanup schedule disabled until the permanent card-use ledger exists on both Neon databases and the publication/subscription reports that table ready. The runtime failover guard checks publication, subscription, and table counts, but that code check does not confirm live Neon configuration.

**Why:** Cleanup removes old employee sessions after archiving card use; a replica without the ledger could hide that permanent history after failover.

**How to apply:** Re-enable the Vercel cron only after read-only checks confirm `card_usage_history` is published and its subscription relation is ready on the fallback.

The user requested removal of the 1,000-employee sample generator and production-side database test tools, including the CU probe that writes a temporary appointment. Keep production test-data generation and probe endpoints out of the app; do not remove existing business rows as part of removing the tools.

**Why:** the user asked to remove the sample-employee creation feature and the tools that run database tests, while preserving the actual storage system.

**How to apply:** Keep fixed data-domain routing, but do not restore capacity thresholds or whole-database failover. Remove production routes and UI that create synthetic test data. Ordinary developer unit tests are not user-facing test tools and may remain.

The user asked to remove the database-switching/status lines from the Settings UI; this removes the visible manual failover and CU-probe entry points, not the backend's automatic routing logic or database data.

**Why:** the earlier UI request removed the visible controls; the later storage decision also disabled global capacity/failover behavior while preserving all four partitioned stores.

**How to apply:** Keep database status/probe dialogs out of Settings unless the user explicitly asks to restore them. Do not change production routing or storage state as part of UI cleanup.
