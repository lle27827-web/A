---
name: Employee deletion and historical management
description: Facility employee deletion removes facility records but preserves card-use history and consumed hours.
---

Deleting an employee soft-deletes the active profile. Preserve all prior-month versions, attendance, card-use and walk-in sessions, wages, and revenue without modification. Remove current-month-and-future attendance and walk-in sessions; retain current-month-and-future card-use details, detach the employee, and zero those sessions' wages. Never change card totals or consumed minutes, so no hours are refunded. Per-account personal notebooks remain unaffected.

**Why:** the user explicitly requires prior-month history to remain unchanged when an employee is deleted in the current month, and customer card hours must never be refunded.

**How to apply:** apply deletion in one transaction using the Asia/Ho_Chi_Minh business-month boundary. Hide the employee from active lists, keep historical versions and records, and prevent new assignments after deletion. Do not physically delete the profile or versions.

Historical month selection applies throughout employee management, including roster, names, wages, visits, search and navigation. Staff added later without backdated work must not appear. Historical employee screens are read-only and retain their month/date across navigation and reload.

**Why:** the user wants the entire employee-management view to show that period's data, not today's roster with an old revenue total.

**How to apply:** use recorded employee versions or actual visit-name snapshots, never silently relabel old history with a current name. Explicitly mark historical identities that were not recorded. Older hard-deleted visits cannot be recovered by inventing rows; they require a genuine backup.
