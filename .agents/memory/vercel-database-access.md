---
name: Vercel database access
description: Replit PostgreSQL connectivity from deployments outside Replit
---

Replit's injected `DATABASE_URL` is scoped to the Replit runtime and cannot be used directly by a Vercel deployment. To reuse the same Replit database externally, obtain the remote connection URL through the Replit Database settings and configure it as Vercel's `DATABASE_URL`. If no remote URL is available, use a database endpoint accessible to Vercel instead.

**Why:** Replit's official documentation distinguishes the internal runtime connection string from the remote connection details used by external services.

**How to apply:** Before claiming an external deployment is connected to Replit data, verify its Vercel environment uses the remote URL. Never put the database URL in source control or chat.
