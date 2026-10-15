---
name: Owner and guest access
description: Product rule for owner login, anonymous guest visibility, and write permissions.
---

Guests need no login and may view the complete employee-management area, including recorded wages and work history. Guests must not access facility revenue or card management. Only the verified owner account may view those areas or write any data. Owner authentication must use external Clerk so it works on both Replit and Vercel.

**Why:** The user explicitly chose anonymous, read-only guests, owner-only editing, external Clerk across both hosts, and limited guests to employee management.

**How to apply:** Enforce the role rules on API reads and writes as well as in route visibility. Never treat a local UI/view preference as proof of owner access.
