---
name: Existing database migration baseline
description: Why the initial migration cannot safely be replayed against the existing populated schema.
---

An existing database may have populated application tables but no entries in the Drizzle migration journal. A journal's existence does not prove that migrations are recorded.

**Why:** the normal migration runner attempted to create an existing tasks table and rolled back before applying a new additive schema update.

**How to apply:** inspect journal contents and actual schema before replaying migrations. Use audited, idempotent additive updates when necessary, never reset user tables or mark historical migrations applied without verifying schema equivalence. Reconcile the baseline as a separate audited change.
