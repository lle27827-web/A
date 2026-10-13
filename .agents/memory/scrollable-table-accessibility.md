---
name: Scrollable table accessibility
description: Why scrollports containing absolutely positioned screen-reader labels need their own positioning context.
---

Make a horizontally scrollable table container a positioning context when its descendants include absolutely positioned screen-reader-only labels.

**Why:** an absolute label in the far-right action-column header can use a containing block outside the scrollport and escape its overflow clipping. This inflates the document width even when the table scrollport itself has the correct width and overflow settings. Adding width constraints or inline-size containment alone does not solve it.

**How to apply:** keep the scrollport positioned relatively, preserve its local horizontal scrolling, and verify the document width in the owner view where hidden action-column labels are actually rendered. Do not hide the entire page's horizontal overflow to conceal the problem.
