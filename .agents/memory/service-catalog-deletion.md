---
name: Service catalog deletion
description: Product rule for removing facility service names without changing recorded history.
---

Do not delete a facility service while any live service session or permanent card-use history references it. After it has no recorded use, deletion is allowed; existing historical snapshots remain unchanged, and recreating the same label creates a new service identity that must not relink old records by name.

**Why:** the user requires used services to remain protected from accidental deletion while retaining the rule that a later same-name service is an independent identity.

**How to apply:** check both live sessions and permanent card-use history before delete; treat service IDs as identity and historical names/rates as snapshots; never infer that old records belong to a recreated service solely because the display name matches.
