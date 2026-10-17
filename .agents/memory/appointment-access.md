---
name: Appointment access
description: Access policy for facility appointments containing customer contact details
---

Facility appointment records are managed separately from employee, card, revenue, and service permissions. Owners can manage all appointments; managers need appointment-specific permission to view them, and a separate edit grant to create, change, or remove them. Editing implies viewing. Managers may delegate appointment access only if they already have the matching permission, and they cannot alter their own grant. Appointment records belong to the facility, not an individual employee notebook. Keep the appointment date separate from the free-text request: the customer may enter a preferred time and employee in the request field, while general notes remain separate. Recording a card-backed service session automatically completes scheduled appointments for the same customer on the same Ho Chi Minh business date when either normalized name or phone matches; this derived status change does not grant appointment-list access.

**Why:** the user selected dedicated appointment permissions, asked card usage for the same customer/date to complete the appointment automatically, and clarified that the request field should hold preferred time and employee separately from notes.

**How to apply:** enforce dedicated view/edit grants on appointment routes and navigation. Perform automatic completion server-side in the card-use transaction, comparing normalized name or phone and the local business date; do not expose appointment rows to managers lacking view permission. Keep facility appointments separate from personal notebook data.
