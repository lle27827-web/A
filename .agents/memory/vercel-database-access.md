---
name: Vercel database access
description: Replit PostgreSQL connectivity from deployments outside Replit
---

Replit-managed PostgreSQL is not externally accessible from Vercel; its injected `DATABASE_URL` only works inside Replit. A Vercel deployment must use a separate externally reachable PostgreSQL database, such as Neon, configured as Vercel's `DATABASE_URL`.

**Why:** Replit's official database documentation confirms that Replit-managed PostgreSQL does not provide an external connection URL for Vercel or other non-Replit apps.

**How to apply:** For Vercel, provision an external PostgreSQL database, apply the app schema, and configure its URL in Vercel's environment settings. Copy existing data separately if needed. Never put the database URL in source control or chat.

The user chose two copies per new data segment and later changed the layout from four stores to three: DB1 holds facility attendance, DB2 holds cards and card history, and DB3 holds personal/shared data plus the registry and write coordinator. Keep each new event on two distinct stores; in a three-store topology, any two readable journals intersect every two-store copy pair.

**Why:** the user explicitly chose three stores and selected moving DB4's data into DB3 before retiring DB4, while retaining two copies per new data segment.

**How to apply:** Use a per-event commit marker so incomplete writes remain hidden. DB4 is migration-only until its business, journal, and coordinator rows are copied to DB3 and verified. Never remove DB4 variables or deploy the three-store runtime before that cutover is confirmed; stop on conflicting rows instead of overwriting.

Previous four-store production notes about DB4 as coordinator are historical and no longer describe the intended layout. The current code-only refactor does not prove DB4 data has been copied; a successful migration and post-copy verification are still required.

The Vercel runtime still maps DB1=`DATABASE_URL_1` + `NEON_DB1_DIRECT_URL`, DB2=`DATABASE_URL_2` + `NEON_DB2_DIRECT_URL`, and DB3=`DATABASE_URL_3` + `NEON_DB3_DIRECT_URL`. During the cutover only, DB4 source data is read through `DATABASE_URL_4` / `NEON_DB4_DIRECT_URL`. `DATABASE_URL` remains the Replit-managed database variable and is not Vercel DB2.

**Why:** the user asked to restore one-to-one matching between each numbered database and its connection variables.

**How to apply:** Keep the DB1–DB3 labels stable. Retain DB4 credentials only until the one-time DB4→DB3 copy and reconciliation are verified; then remove DB4 runtime/direct variables from Vercel.

DB3 is the chosen routing coordinator in the three-store design; it is a single point of failure for new partition writes.

**Why:** the user chose DB3 to receive the data and coordinator role previously held by DB4.

**How to apply:** Store the routing cursor, registry, global ID counters, and idempotent operation coordination on DB3; if DB3 is unavailable, stop new routed writes rather than guessing a shard.

Historical logical replication included DB4. Do not delete or disable the DB4 database or subscriptions until the owner has verified DB4→DB3 data parity and checked whether any other consumers still rely on the old replication chain.

**Why:** direct subscriber deletes can conflict with pending upstream changes or allow data to reappear; the live topology is not bidirectional.

**How to apply:** For the DB4 retirement, pause writes, copy without deleting the source, validate conflicts and row counts, then keep DB4 available for rollback until the three-store deployment is confirmed.

The user wants three Neon databases in fixed data-domain partitions and removed capacity-based routing. When a store is full, the owner will upgrade it; only a genuine connection failure may retry the affected domain write on another two-store pair. Whole-database promotion must not mix data domains.

**Why:** the user explicitly chose to keep the data partitioned while retiring DB4, and to handle capacity by upgrading rather than moving writes when a limit is reached.

**How to apply:** Do not call Neon CU APIs or query database size during ordinary requests. Do not reroute on capacity, I/O, or configuration-limit errors. Keep DB1–DB3 URLs; retain DB4 only through verified migration. Verify Neon logical replication consumers before disabling old subscriptions.

Partitioned reads need two successful journals in the three-store design, with a third queried only to replace an unavailable copy. The base snapshot is read from the first event-readable store, trying another only if that read fails. Each committed event is copied to two distinct stores.

**Why:** in the three-store design, two journal reads preserve one-store-outage coverage while avoiding unnecessary Neon compute.

**How to apply:** Preserve two successful journal reads while each event has two copies. Revisit this coverage proof before changing the replica count or fallback routing; do not restore all-store base-read fan-out.

The prior LZ4 compression note applied to four stores; verify the setting on DB1–DB3 after the cutover. This changes compression for future TOAST values; it does not rewrite existing rows.

**Why:** the user requested storage savings while preserving ordinary reads; the old verification covered the four-store layout.

**How to apply:** Verify the setting on each retained store and do not claim existing data has been compacted; verify the default after reconnecting sessions.

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

**Why:** the earlier UI request removed the visible controls; the later storage decision also disabled global capacity/failover behavior while preserving fixed three-store partitions.

**How to apply:** Keep database status/probe dialogs out of Settings unless the user explicitly asks to restore them. Do not change production routing or storage state as part of UI cleanup.
