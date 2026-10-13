---
name: Archived treatment cards
description: Why removed customer cards retain stored history and how financial reports handle it.
---

Cards with a deletion timestamp stay in the database as audit records. Do not physically delete these rows or drop the timestamp column by default. Exclude archived-card sales, usage shifts, wages and visits from active lists and calculations.

**Why:** a schema change that dropped the archive marker reported five existing card rows with data. Automatically dropping the column or deleting linked history would erase records unexpectedly.

**How to apply:** when changing card deletion, balances, employee payroll or daily/monthly revenue, test that archived card data is absent from active screens and calculations, while the stored history remains intact.
