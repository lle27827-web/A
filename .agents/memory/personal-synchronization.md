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

Compare total recorded minutes per normalized service name within the selected date or month. Hide services whose totals match; display only service types with a different total, with the facility and personal totals side by side. Pay, rate, customer text and notes do not affect hour totals.

**Why:** the user later clarified that comparison should total hours by service for the selected day, such as facility 5 hours versus personal 3 hours. This replaces the earlier per-occurrence matching rule.

**How to apply:** aggregate each side independently by service, compare minutes, and show only unequal service totals. The employee selector must use the same current roster as facility management for the current month and historical identities for past months. Distinct employee identities that genuinely share a name must remain distinct and clearly labelled; never silently merge their work by name.

For a service recorded on only one side, display zero hours on the missing side. Keep the selected day or month visible so the aggregate is clearly scoped.

**Why:** service-hour comparison requires showing the size of the discrepancy, including a zero total when no shifts exist on one side.

**How to apply:** do not pair or list individual shifts in this comparison view; show one summary row per service with unequal totals.

When the selected range contains shifts and every occurrence matches, hide the discrepancy history and show a concise “Dữ liệu đã khớp” status. When neither side has any shifts, report that there are no shifts to compare instead of claiming a match.

**Why:** the user asked not to show old comparison history after complete matching and to report clearly that the data matches.

**How to apply:** render only current unmatched occurrences; do not treat an empty range as a successful match.

Always fetch a fresh comparison when the dialog opens or its selected employee changes. Edits to either notebook must invalidate the comparison, and cached results must not be presented as current while a refresh is in progress.

**Why:** the user requires edits that make the two records match to be recognized on the next comparison, rather than leaving a stale mismatch visible.

**How to apply:** keep comparison queries fresh on mount, invalidate them after personal or facility session mutations, and show a loading state until the refreshed snapshot arrives.
