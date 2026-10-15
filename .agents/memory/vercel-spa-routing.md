---
name: Vercel SPA routing
description: Deep-link fallback behavior for the task-manager Vite service in the Vercel multi-service deployment.
---

For Vercel service-targeted rewrites, client-side routes must target the task-manager service's `/index.html`; preserving the incoming route returns 404 on direct navigation. Route `/api/*` and static asset paths to their services/files before the catch-all fallback.

**Why:** The live deployment served `/` and API requests but returned Vercel 404 for `/employees` and `/sign-in`. The service destination's `path` selects the resource inside the target service without changing the browser URL.

**How to apply:** When modifying `vercel.json`, keep the API rule first, pass `/assets/*` and root public files through unchanged, then route remaining app paths to `/index.html`. Retest direct routes after a Vercel redeploy.
