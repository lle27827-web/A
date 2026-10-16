---
name: Personal notebook synchronization
description: User-approved replacement scope and wage-library rules for importing facility shifts into private notebooks.
---

“Cập nhật dữ liệu từ cơ sở” replaces ALL private shifts in the explicitly selected day or month, including manually entered shifts, only after a confirmation that identifies the employee, range and removed/imported counts. Other periods, accounts and facility records must remain unchanged.

**Why:** the user chose “Thay thế toàn bộ ca trong ngày/tháng đã chọn, có xác nhận trước” rather than additive import.

**How to apply:** never import just by opening comparison, selecting an employee or enabling facility rates. Require a new preview/confirmation if source or private data changes before the operation. Treat an empty source as a potentially destructive replacement, not an automatic cleanup.

Facility-library mode uses facility service names and EMPLOYEE pay rates, not customer prices. Turning it off restores the account's own catalog. Historical shifts retain the wages actually recorded at the time, even if the current catalog price changes.

**Why:** the user requested optional service/pay synchronization while keeping every account's notebook separate; repricing old shifts would break historical comparison and recorded income.

**How to apply:** keep the choice account-specific, do not synchronize private data back into the facility, and compare detailed occurrences rather than collapsing legitimate same-day visits.

Match comparisons one occurrence at a time by date, service, recorded duration and actual employee pay. Customer text, hidden notes and current catalog rates must not make an otherwise identical worked shift mismatch. Show only unmatched individual shifts, with overall counts and service/hour/pay summaries for context.

**Why:** the user explicitly gave the example of five one-hour facility shifts versus four one-hour personal shifts and one ninety-minute personal shift: four pairs disappear and one unmatched shift remains on each side.

**How to apply:** never compare totals alone or reuse one shift for multiple matches. The employee selector must use the same current roster as facility management for the current month and historical identities for past months. Distinct employee identities that genuinely share a name must remain distinct and clearly labelled; never silently merge their work by name.

Display each remaining unmatched occurrence as an explicit facility-versus-personal pair. If one side has no remaining occurrence, state plainly that there is no shift on that side rather than suggesting the comparison is complete.

**Why:** the user requested visible pairs when a facility shift has a different duration from its personal counterpart and an explicit “no shift” label when the other side has not recorded it.

**How to apply:** after exact matches are removed, pair leftover occurrences within their date/service group one to one; display every extra occurrence with an explicit empty counterpart.
