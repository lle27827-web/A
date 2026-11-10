---
name: Business audit history
description: Tenant isolation and write consistency rules for business audit records.
---

Keep audit records tenant-scoped in the shared business domain and write each record as part of the same idempotent mutation as the business change. Store only the actor and the minimum before/after values needed for operational review; do not copy customer names, phone numbers, or unrelated personal data into the audit trail.

**Why:** A partial audit write would misrepresent whether a business change committed, and a cross-tenant record could expose or overwrite another business's history.

**How to apply:** When adding a mutation that changes financial or employee data, add its audit entry to that operation's event set, preserve business scoping, and extend all four store schema checks and additive migrations together.
