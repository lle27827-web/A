---
name: Vercel SPA routing
description: Deep-link fallback behavior for the task-manager Vite service in the Vercel multi-service deployment.
---

At the project level, a service-targeted rewrite chooses which service handles a request but the service still receives the original URL path. Setting only the destination's `path` does not rewrite the path seen by the service. Use a service-local `request.path` transform to `/index.html` for SPA routes, while excluding static assets.

**Why:** The live deployment still returned 404 for `/employees` and `/sign-in` after a top-level destination-path fallback. Vercel's service-routing documentation states that the service receives the original path and needs its own path transform.

**How to apply:** When modifying `vercel.json`, keep `/api/*` routed to the API first; use a service-local route transform for frontend paths, preserve `/assets/*` and root public files, then retest direct routes after a Vercel redeploy.
