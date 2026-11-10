---
name: pnpm override enforcement
description: How dependency overrides are applied and verified in this pnpm workspace.
---

Keep dependency security overrides in the root `package.json` under `pnpm.overrides`. In this workspace, adding them to `pnpm-workspace.yaml` appeared in `pnpm config get overrides` but did not change the lockfile or installed package tree.

**Why:** A security audit still found vulnerable transitive versions after workspace-level overrides; moving the overrides into the root manifest and reinstalling resolved them.

**How to apply:** After changing overrides, run `pnpm install`, then verify both `pnpm-lock.yaml` and `pnpm why <package>`. Do not treat the configuration listing alone as proof that the fix took effect.
