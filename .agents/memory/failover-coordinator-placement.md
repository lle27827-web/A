---
name: Partition coordinator placement
description: The user's chosen write-routing control plane and its accepted availability tradeoff.
---

Use DB4 as the partition-routing coordinator. The user explicitly accepted that DB4 is a single point of failure.

**Why:** the user requested DB4 coordination rather than creating a fifth, independent database.

**How to apply:** store the write-shard cursor and saga/idempotency coordination on DB4. If DB4 is unavailable/full, block new routed writes until coordination recovers; never pick a shard independently per server instance.
