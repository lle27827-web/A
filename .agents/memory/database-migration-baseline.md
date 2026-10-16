---
name: Existing database migration baseline
description: Why the initial migration cannot safely be replayed against the existing populated schema.
---

An existing database may have populated application tables but no entries in the Drizzle migration journal. A journal's existence does not prove that migrations are recorded.

**Why:** the normal migration runner attempted to create an existing tasks table and rolled back before applying a new additive schema update.

**How to apply:** inspect journal contents and actual schema before replaying migrations. Use audited, idempotent additive updates when necessary, never reset user tables or mark historical migrations applied without verifying schema equivalence. Reconcile the baseline as a separate audited change.

Schema equivalence is semantic, not physical: column storage order and the current serial counter may differ without schema drift. Types, nullability, defaults, sequence ownership/settings, constraint/index definitions and required data backfills must still agree.

**Why:** existing populated tables can have columns in a different physical order, while their data and behavior remain equivalent; treating ordinal position or consumed IDs as drift would encourage unnecessary destructive rebuilding.

**How to apply:** use the audited workflow documented in `lib/db/MIGRATIONS.md`; do not replace a baseline refusal with `push` or manual journal rows. The Vercel compatibility updates deliberately do not record a baseline. Development equivalence never proves production equivalence.

Keep baseline reference SQL restricted to reviewed immutable migrations rather than executing arbitrary future migrations in a shadow schema.

**Why:** future SQL may contain cross-schema DML, and sequence changes do not roll back. A shadow schema alone is not a sandbox.

**How to apply:** append normal upgrade migrations; extending historical-baseline support requires a separate review of schema references and backfill semantics, not automatic regeneration of trusted hashes.
