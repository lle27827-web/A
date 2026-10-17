---
name: Card-use revenue reporting
description: The business rule for the owner-facing monthly and daily totals when a customer uses a treatment card.
---

Keep customer service prices separate from employee pay for every service type. Calculate gross customer revenue as walk-in service charges plus card purchases on their purchase dates; a card redemption must not add revenue again. Keep employee payroll distinct in the underlying data, including active card-linked sessions, while continuing to exclude archived-card records from active totals. Never infer historical customer prices from the old employee-pay rates.

**Why:** the user chose separate customer prices and employee pay. Earlier records stored employee pay but not customer charges, and the app does not record cash value per card redemption.

**How to apply:** preserve these distinctions in daily and monthly summaries, session snapshots, and future exports. Do not estimate redemption revenue or retroactively assign customer prices to old sessions without verified source data.

For user-facing service and attendance screens, label the customer charge “Tiền dịch vụ” and the employee amount “Tiền công.” Keep explanatory helper copy concise and remove duplicate instructions.

**Why:** the user requested this terminology and a less cluttered attendance/service setup flow.

**How to apply:** change display labels and copy only; preserve the separate customer-price and payroll values and their calculations.

Card top-ups have both hours and money. Recognize each payment on its own transaction date in Vietnam time, not the original card purchase date. Preserve the initial purchase and every subsequent credit separately. Do not fabricate histories or amounts for past unrecorded credits.

Creating a card matching an active card's customer name, phone and service must credit that existing card and retain its usage and payment history. Compare case/spacing-normalized names/services and phone digits; do not merge different names by removing Vietnamese accents.

Monthly and daily “Doanh thu đã khấu trừ” means walk-in customer charges plus original card sales and top-up cash, minus wages for walk-in sessions only. Card sessions must not change this metric at all: exclude both their service charges and their wages, but retain their wages in employee payroll. Walk-in losses may produce a negative amount.

**Why:** the user explicitly chose “Giữ nguyên doanh thu; tiền công ca dùng thẻ chỉ ghi vào lương nhân viên” after reporting that card attendance reduced the metric. This replaces the earlier rule that deducted all session wages. This is the user's custom revenue metric, not profit after all labor costs.

**How to apply:** credit balance and payment history atomically; protect concurrent new-card matches as well as existing-card credits. Exclude archived cards and their payments/wages from active reports. Keep owner-only financial access.

Keep both the original gross “Tổng doanh thu cơ sở” and the separate “Doanh thu đã khấu trừ” rows in monthly and daily reports. Remove only the separate employee-pay rows; keep the walk-in wage deduction in net calculations. Settings should open the previous month's revenue history.

**Why:** the user clarified that both original totals must remain, rather than replacing gross revenue with net revenue; only the payroll display is to be removed.

**How to apply:** retain gross component values and payroll in calculations; hiding payroll must never remove its deduction. Historical month/day selections must request the matching dated report and survive reloads.

The card-use history table should show only service date/recorded time, technician, hours and notes, plus owner edit/delete controls. Show only the latest use by default; older uses require expanding the history. Keep payment/top-up history collapsible in the same card-history area. Do not repeat customer identity, service or amounts in the usage table.

**Why:** the user requested a compact card-use history without customer and payment lines, then explicitly requested that older uses and payment history be opened on demand.

**How to apply:** limit this presentation change to card-use history; retain stored identity, payment history, wage calculations and the employee-attendance view.

For monthly package popularity, rank sales by the number of active cards purchased per service type and rank usage by the number of active-card service visits per service type. Show the total redeemed minutes alongside the usage count. Top-ups are not new card sales, and archived cards do not contribute.

**Why:** the user requested monthly counts of the most-sold and most-used card services; purchase and redemption records have separate dates, and top-ups are separate transactions rather than new cards.

**How to apply:** use purchase date for sales and work date for usage, group by the stored service type, and exclude archived cards and their visits.
