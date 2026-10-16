---
name: Archived treatment cards
description: Why removed customer cards retain stored history and how financial reports handle it.
---

Cards with a deletion timestamp stay in the database as audit records. Do not physically delete these rows or drop the timestamp column by default. Exclude archived-card sales, usage shifts, wages and visits from active lists and calculations.

**Why:** a schema change that dropped the archive marker reported five existing card rows with data. Automatically dropping the column or deleting linked history would erase records unexpectedly.

**How to apply:** when changing card deletion, balances, employee payroll or daily/monthly revenue, test that archived card data is absent from active screens and calculations, while the stored history remains intact.

Never allow a card that has ever been used to be deleted or archived through normal app operations. Retain this protection even after the last visit is deleted or reassigned. Unused cards may still be archived; old archived records remain excluded by the policy above.

**Why:** the user explicitly requested “Thẻ khách hàng khi đã dùng thì không thể xóa”.

**How to apply:** enforce the restriction on the server as well as in the UI, serialize it with recording use, and preserve the existing card, hours, payments, wages and visit history when deletion is refused.
