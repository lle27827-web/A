---
name: Archived treatment cards
description: Why removed customer cards retain stored history and how financial reports handle it.
---

Cards with a deletion timestamp stay in the database as audit records. Do not physically delete these rows or drop the timestamp column by default. Hide archived cards from active card lists and exclude their purchase/top-up revenue and card-use metrics, but keep all employee shifts and wages in employee history and payroll.

**Why:** a schema change that dropped the archive marker reported five existing card rows with data. The user requires deleted cards' employee attendance and pay to remain unchanged, card-sale/top-up revenue to leave active reports, and archived cards to stay hidden from the active list without a separate archive view.

**How to apply:** when changing card deletion, balances, employee payroll or daily/monthly revenue, test that archived card sales are excluded, employee shifts/pay are retained, and all stored history remains intact.

Allow a card to be archived at any time, whether it is unused, partially used, or fully used. Archiving is soft-only: preserve the card, top-ups, employee shifts, consumed minutes, and usage history; do not refund remaining hours or employee pay. A confirmed duplicate-card merge is a separate operation: keep all usage and payments on the surviving card, and retain the retired source for audit.

**Why:** the user explicitly removed the remaining-hours/usage eligibility restriction while asking to keep every other card-deletion behavior unchanged.

**How to apply:** retain transactional locking against concurrent use/top-ups and the existing soft-delete/report behavior. Confirm that remaining hours are forfeited, payment history is retained, and card sales/top-up revenue leaves active reports.

Card-use history is permanent even when its associated employee work session is automatically removed after five years. The archived ledger must retain the customer, employee name, service, date, used minutes, charges, pay, and note; its minutes remain consumed after either card archival or employee-history cleanup.

**Why:** the user requires card usage records to remain available forever and explicitly forbids returning used hours when old work history is deleted.

**How to apply:** archive card-backed sessions transactionally before deleting old employee sessions, count live and archived usage together, include both in card detail history, and move archived entries when cards are merged. Card deletion must not remove the permanent usage ledger.

Both creating and editing a card must detect a duplicate only when customer name, phone and service all match, and ask for confirmation before combining. Combining cards must retain original sale/top-up dates and recognize each cash receipt once.

**Why:** the user explicitly requested the same duplicate handling when editing customer-card details and a “thẻ đã có, xác nhận cộng vào” warning before merging.

**How to apply:** do not silently combine on identity edits, remove usage history, or recognize historical receipts again on the merge date.
