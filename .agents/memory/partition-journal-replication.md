---
name: Partition journal and logical replication
description: Safety condition for the append-only event journal used by Neon partition routing.
---

The `storage_partition_events` journal is written directly to each operation's primary and replica. Keep it out of Neon logical replication publications and subscriptions; replicating those rows can collide with direct dual writes.

**Why:** a replicated copy and an application-written copy of the same event can cause duplicate-key conflicts or leave ambiguous partial operations.

**How to apply:** verify journal publication/subscription membership on every Neon store before enabling event-journal routing. Review replication of business tables separately; never claim external Vercel stores are ready without a successful check.
