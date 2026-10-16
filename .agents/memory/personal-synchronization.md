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
