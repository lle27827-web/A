---
name: Service catalog deletion
description: Product rule for removing facility service names without changing recorded history.
---

When a facility service is deleted, existing attendance, pay, card-use, and history records keep their saved service names and amounts. Recreating the same label creates a new service identity and must not relink old records by name.

**Why:** the user explicitly requested that service names be removable while preserving all old data, and that a later same-name service remain independent.

**How to apply:** treat service IDs as identity and historical names/rates as snapshots; never infer that old records belong to a recreated service solely because the display name matches.
