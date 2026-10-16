---
name: Drizzle nested select qualification
description: Avoid ambiguous columns when raw SQL subqueries contain joins inside a selected field.
---

In this Drizzle setup, column interpolations inside a raw SQL selected field can be rendered without table qualification. Nested joins with two `id` columns then become ambiguous even when the TypeScript expression references different table objects.

**Why:** adding a joined payment aggregate produced an unqualified `id = card_id` and PostgreSQL rejected the summary query.

**How to apply:** explicitly qualify identifiers in joined raw subqueries (including the table identifier rather than relying only on a column object), and inspect emitted SQL when diagnosing aggregate failures.
