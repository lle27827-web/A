---
name: Card-use revenue reporting
description: The business rule for the owner-facing monthly and daily totals when a customer uses a treatment card.
---

Keep customer service prices separate from employee pay for every service type. Report gross customer revenue as walk-in service charges plus card purchases on their purchase dates; a card redemption must not add revenue again. Report employee payroll separately from session wages, including active card-linked sessions, while continuing to exclude archived-card records from active totals. Never infer historical customer prices from the old employee-pay rates.

**Why:** the user chose separate customer prices and employee pay. Earlier records stored employee pay but not customer charges, and the app does not record cash value per card redemption.

**How to apply:** preserve these distinctions in daily and monthly summaries, session snapshots, and future exports. Do not estimate redemption revenue or retroactively assign customer prices to old sessions without verified source data.

For user-facing service and attendance screens, label the customer charge “Tiền dịch vụ” and the employee amount “Tiền công.” Keep explanatory helper copy concise and remove duplicate instructions.

**Why:** the user requested this terminology and a less cluttered attendance/service setup flow.

**How to apply:** change display labels and copy only; preserve the separate customer-price and payroll values and their calculations.

Card top-ups have both hours and money. Recognize each payment on its own transaction date in Vietnam time, not the original card purchase date. Preserve the initial purchase and every subsequent credit separately. Do not fabricate histories or amounts for past unrecorded credits.

Creating a card matching an active card's customer name, phone and service must credit that existing card and retain its usage and payment history. Compare case/spacing-normalized names/services and phone digits; do not merge different names by removing Vietnamese accents.

Monthly and daily “Doanh thu đã khấu trừ” means walk-in customer charges plus original card sales and top-up cash, minus wages for all active walk-in and card sessions. Redemptions add no revenue, and net amounts may be negative.

**Why:** the user explicitly requested paid top-ups, automatic duplicate-card credits with history, and owner revenue after employee pay without double-counting card usage.

**How to apply:** credit balance and payment history atomically; protect concurrent new-card matches as well as existing-card credits. Exclude archived cards and their payments/wages from active reports. Keep owner-only financial access.
