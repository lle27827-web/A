---
name: GitHub push verification
description: Confirm remote push authentication and deployment status before treating local commits as live.
---

After changing code, a local commit on `main` does not mean GitHub or Vercel has received it. Confirm the push succeeded and the remote branch advanced before calling the production build updated. If GitHub authentication fails, reconnect through Replit's connected-services flow; never print or request tokens in chat.

**Why:** A workspace can create a local commit while its GitHub remote rejects the push, leaving production unchanged.

**How to apply:** Before checking a feature on Vercel, verify the commit is on the deployment branch and confirm the live build has deployed. Keep production database actions separate from code deployment.
