---
name: Vercel SPA routing
description: Deep-link fallback behavior for the task-manager Vite service in the Vercel multi-service deployment.
---

At the project level, a service-targeted rewrite chooses which service handles a request but the service still receives the original URL path. A destination's `path` selects a route; it does not change the runtime-observed path.

For a static SPA, the service-local fallback must select the actual index document with `dest: "/index.html"`. A `request.path` transform alone does not change route selection or resolve a static file. Low-level `routes[].src` uses a raw PCRE-compatible regex, not the `:path(...)` parameter syntax used by higher-level rewrites.

**Why:** The deployed homepage worked while direct employee and sign-in URLs returned Vercel NOT_FOUND. The previous fallback never matched because it mixed route syntaxes, and its path transform also lacked a static-file destination. Vercel documents route lookup and runtime path overrides as separate operations.

**How to apply:** Keep API rewrites first. Use a service-local raw-regex SPA route with an index destination and, where needed, a runtime path transform; exclude API and static assets. Verify positive and negative route cases, then retest direct URLs after a Vercel redeploy. Local Vite fallback is not proof that production routing works.
