---
name: Vercel database access
description: Replit PostgreSQL connectivity from deployments outside Replit
---

Replit-managed PostgreSQL is not externally accessible from Vercel; its injected `DATABASE_URL` only works inside Replit. A Vercel deployment must use a separate externally reachable PostgreSQL database, such as Neon, configured as Vercel's `DATABASE_URL`.

**Why:** Replit's official database documentation confirms that Replit-managed PostgreSQL does not provide an external connection URL for Vercel or other non-Replit apps.

**How to apply:** For Vercel, provision an external PostgreSQL database, apply the app schema, and configure its URL in Vercel's environment settings. Copy existing data separately if needed. Never put the database URL in source control or chat.
