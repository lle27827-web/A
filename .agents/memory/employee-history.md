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

Facility month-history mode should use the home dashboard, retain employee management and all revenue totals, and hide card management, appointments, and service/pricing navigation. Keep the selected month when opening employee details or reloading; historical routes remain read-only.

**Why:** the user asked for the previous-month facility view to match the main interface while showing only employee and revenue information, with a concise month list in Settings.

**How to apply:** use the existing month query for all history requests, suppress current-only navigation and card search results in that mode, and show an empty state when no records exist rather than fabricating history.

Facility and personal attendance/work-session history is retained for a rolling five years. Automatically remove older attendance, walk-in sessions, personal sessions, and card-linked employee sessions. Before deleting an old card-linked session, copy its complete customer, employee, service, date, time, pay, and note snapshot to permanent card-use history. Archived card-use minutes still count as consumed; cleanup must never restore card hours or alter card totals.

**Why:** the user requires employee work history to expire after five years but customer card balances and complete card-use history to remain indefinitely.

**How to apply:** calculate the cutoff by Vietnam calendar date; archive card-backed sessions and delete the source rows in one transaction. Keep archived snapshots out of employee payroll/history views, include them in card balances and card detail history, and retain the used-card deletion restriction.

Manual history deletion uses a user-selected inclusive date range and is facility-only. Preview the affected counts, preserve personal notebook sessions and permanent card-use history, and archive card-backed facility sessions before removing their source sessions. In partitioned mode, replicate tombstones so records disappear from application reads; physical journal compaction is separate and may be needed to reclaim storage.

**Why:** the user asked to fix manual history deletion and remove the extra typed-confirmation step, while keeping manual deletion facility-only. Card balances, permanent use history, and personal records must remain untouched.

**How to apply:** require owner access, preview counts, use inclusive date bounds, archive card use before tombstoning attendance/session rows, and keep the UI honest that tombstones remove rows from normal reads but do not immediately reclaim bytes. The delete button should execute after the user selects dates and clicks once; do not require typing a confirmation word.
