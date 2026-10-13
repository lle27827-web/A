---
name: Orval parameter collisions
description: Avoid duplicate parameter exports when an operation combines path and query parameters.
---

The workspace generator can give a query-parameter TypeScript interface and a path-parameter Zod schema the same exported name when an operation has both kinds of parameters. Prefer query-only summary/report endpoints, or inspect generated parameter names before adopting a mixed-parameter route.

**Why:** generation can succeed but the shared barrel fails TypeScript compilation with duplicate exports. Editing generated files only hides the problem until the next generation.

**How to apply:** when adding report endpoints with an entity identifier and a date/month filter, check codegen and the shared-library typecheck together. Fix the contract rather than manually changing the generated barrel.
