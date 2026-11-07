---
name: Managed workflow port conflicts
description: Handle managed workflows that report failure while an earlier server still owns the port.
---

A managed Vite or API workflow can report failure with `EADDRINUSE` while its earlier process is still listening on the expected port. A failed workflow status alone does not prove the preview is unavailable.

**Why:** On 2026-11-07, restarting the task-manager and API workflows launched duplicate servers; the existing Vite and API processes continued running, and the frontend still returned HTTP 200.

**How to apply:** Check the latest workflow log, process list, listening ports, and an HTTP request before retrying. If the existing frontend is healthy and hot reloads changes, use it rather than restarting repeatedly. If a restart is necessary, resolve the exact stale listener first and restart the managed workflow once; do not add a duplicate workflow or change the artifact's managed port configuration.
