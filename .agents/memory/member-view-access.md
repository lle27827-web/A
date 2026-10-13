---
name: Employee read-only access
description: Product access boundary for employee management, shift history, and payroll.
---

**Rule:** Any authenticated account may view the employee list, employee details, shift history, and payroll. Only the owner or an authorized manager may add, edit, or delete records. Cards, attendance, services, and facility revenue remain restricted to managers.

**Why:** The owner requested employee-management visibility for everyone who signs in without broadening write permissions or exposing other business sections.

**How to apply:** Enforce permissions in both the API and the UI. Scope read-only shift queries to a member ID, and protect card/customer and revenue endpoints independently; do not remove the authorization boundary globally.
