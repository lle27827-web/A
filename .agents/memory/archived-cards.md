---
name: Archived treatment cards
description: Why removed customer cards retain stored history and how financial reports handle it.
---

Cards with a deletion timestamp stay in the database as audit records. Do not physically delete these rows or drop the timestamp column by default. Exclude archived-card sales, usage shifts, wages and visits from active lists and calculations.

**Why:** a schema change that dropped the archive marker reported five existing card rows with data. Automatically dropping the column or deleting linked history would erase records unexpectedly.

**How to apply:** when changing card deletion, balances, employee payroll or daily/monthly revenue, test that archived card data is absent from active screens and calculations, while the stored history remains intact.

Never allow a card that has ever been used to be deleted or archived through the normal delete operation. Retain this protection even after the last visit is deleted or reassigned. Unused cards may still be archived; old archived records remain excluded by the policy above. A confirmed duplicate-card merge is a separate operation: keep all usage, payments and the ever-used protection on the surviving card; retaining the retired source for audit is not a deletion of its history.

**Why:** the user explicitly requested “Thẻ khách hàng khi đã dùng thì không thể xóa”.

**How to apply:** enforce the restriction on the server as well as in the UI, serialize it with recording use, and preserve the existing card, hours, payments, wages and visit history when deletion is refused.

Card-use history is permanent even when its associated employee work session is automatically removed after five years. The archived ledger must retain the customer, employee name, service, date, used minutes, charges, pay, and note; its minutes remain consumed and the card cannot become deletable after cleanup.

**Why:** the user requires card usage records to remain available forever and explicitly forbids returning used hours when old work history is deleted.

**How to apply:** archive card-backed sessions transactionally before deleting old employee sessions, count live and archived usage together, include both in card detail history, and move archived entries when cards are merged.

Both creating and editing a card must detect a duplicate only when customer name, phone and service all match, and ask for confirmation before combining. Combining cards must retain original sale/top-up dates and recognize each cash receipt once.

**Why:** the user explicitly requested the same duplicate handling when editing customer-card details and a “thẻ đã có, xác nhận cộng vào” warning before merging.

**How to apply:** do not silently combine on identity edits, remove usage history, or recognize historical receipts again on the merge date.
