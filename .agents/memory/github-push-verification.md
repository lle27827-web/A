---
name: GitHub push verification
description: Confirm remote push authentication and deployment status before treating local commits as live.
---

After changing code, a local commit on `main` does not mean GitHub or Vercel has received it. Confirm the push succeeded and the remote branch advanced before calling the production build updated. If GitHub authentication fails, reconnect through Replit's connected-services flow; never print or request tokens in chat.

**Why:** A workspace can create a local commit while its GitHub remote rejects the push, leaving production unchanged.

**How to apply:** Before checking a feature on Vercel, verify the commit is on the deployment branch and confirm the live build has deployed. Keep production database actions separate from code deployment.

The GitHub API connector's OAuth attachment may remain in `connect` state and does not necessarily authenticate the shell's Git remote. An API connection is not proof that `git push` is authorized.

**Why:** A push attempt was rejected even after the API connector reported an attachment; the connector status stayed unready.

**How to apply:** Check the actual Git remote push result. If rejected, reconnect the workspace's source-control GitHub authorization through its supported flow; do not request or expose a token.
