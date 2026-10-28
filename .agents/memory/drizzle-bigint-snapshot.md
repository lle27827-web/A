---
name: Drizzle snapshot BigInt serialization
description: A migration-generation failure seen when Drizzle tries to serialize BigInt values from the existing schema snapshot.
---

When Drizzle migration generation fails with `Do not know how to serialize a BigInt`, do not edit generated migration or snapshot files by hand. Keep generated code produced by the normal codegen flow, and use the project's reviewed, idempotent additive migration path for the database change while the snapshot issue is unresolved.

**Why:** the schema generator encountered a BigInt serialization error while comparing the existing database snapshot; hand-editing generated history could create an unreliable migration baseline.

**How to apply:** distinguish API codegen from database migration generation, run and verify both separately, and use an additive migration script only when it is safe and idempotent. Revisit standard Drizzle generation after fixing the snapshot serialization issue.
