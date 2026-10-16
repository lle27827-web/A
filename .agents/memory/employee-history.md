---
name: Employee deletion and historical management
description: Staff removal must preserve card-use history and period-specific employee views.
---

Deleting an employee hides them from the current roster. It must not delete their card or walk-in visits, change recorded technician names/wages, refund consumed card hours, or alter earned payroll/revenue.

**Why:** the user explicitly requires customers' old card-use histories to remain unchanged after removing an employee.

**How to apply:** preserve employee identity and recorded visit snapshots; reject new assignments to removed employees while allowing an explicit correction to retain the original employee on the same existing visit.

Historical month selection applies throughout employee management, including roster, names, wages, visits, search and navigation. Staff added later without backdated work must not appear. Removed staff who existed or worked in that month remain available. Historical employee screens are read-only and retain their month/date across navigation and reload.

**Why:** the user wants the entire employee-management view to show that period's data, not today's roster with an old revenue total.

**How to apply:** use recorded employee versions or actual visit-name snapshots, never silently relabel old history with a current name. Explicitly mark historical identities that were not recorded. Older hard-deleted visits cannot be recovered by inventing rows; they require a genuine backup.
