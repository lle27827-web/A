---
name: React workspace compatibility
description: React peer-version constraints when a Clerk-enabled web artifact shares a workspace with Expo.
---

Keep any React version override local to the web artifact. The workspace's shared React versions are pinned for Expo compatibility, while the Clerk web SDK may require a newer matching React/React DOM patch release.

**Why:** A workspace-wide React upgrade can break Expo, and a stale Vite dependency bundle can keep loading the previous React DOM version after reinstalling packages.

**How to apply:** When adding Clerk to a web artifact, check its peer range, pin `react` and `react-dom` to the same compatible version in that artifact, and clear that artifact's Vite optimized-dependency cache if the runtime still reports a version mismatch.
