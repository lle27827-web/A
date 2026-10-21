---
name: Failover coordinator placement
description: The user's chosen control-plane location and its accepted availability tradeoff.
---

Use DB4 as the failover-state coordinator. The user explicitly accepted that DB4 is a single point of failure.

**Why:** the user requested DB4 coordination rather than creating a fifth, independent database.

**How to apply:** keep the coordinator row on DB4 after its explicit state migration. Do not claim failover is guaranteed when DB4 is unavailable/full. Continue to block promotion if replication catch-up cannot be verified; do not risk split-brain or silently lose unreplicated writes.
