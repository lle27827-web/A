---
name: Concise accessible presentation
description: User wants short headings and comparison summaries instead of long repeated descriptions.
---

Keep this application's screen-reader labels focused on titles; do not append long optional explanations to dialog titles or control names. Remove unnecessary descriptive copy from personal notebook and comparison screens.

**Why:** the user repeatedly requested that the screen reader read titles rather than long accompanying descriptions.

**How to apply:** preserve accessible controls, actual financial data, error announcements and destructive-action warnings. Never hide an interactive element or required safety information merely to shorten speech.

Comparison discrepancies should briefly identify service, date, customer if present, the personal/facility shift counts and amounts. Keep the complete shift lists available on demand rather than repeating them automatically.

**Why:** the user explicitly requested compact discrepancy lines and short money comparisons.

**How to apply:** simplify presentation only; retain occurrence-level comparison, wage calculations and explicit confirmation before replacing private shifts.

In the facility employee roster, keep employee names left-aligned and show monthly and selected-day wages in a larger, right-aligned summary without repeating shift counts or service-by-service listings. In employee details, right-align money and statistics, keep the employee name left-aligned, show month/day totals and service hours, and leave each attendance row expanded with customer type/name, service and duration.

**Why:** the user requested left-aligned names, right-aligned financial totals, larger type, full service-hour statistics and always-visible attendance details.

**How to apply:** do not put shift details in the roster list; in employee detail, aggregate minutes by service for the selected month/day and render every daily attendance row without a reveal control.

Do not show note inputs or note rows on the application's screens. Facility and personal attendance use separate whole-hour and minute inputs; new shifts default to 1 hour and 0 minutes, with quick choices for 30 minutes, 1 hour, 2 hours and 3 hours.

**Why:** the user explicitly asked to remove every note row, then requested a separate minutes input and quick duration choices in both attendance forms.

**How to apply:** removing note UI is not permission to erase previously stored notes. Preserve hidden note data when editing unrelated fields; validate the combined duration from 1 minute to 24 hours and retain exact minutes when editing a shift.

Voice-entry controls must stay inside their input fields on every screen size. Hour and minute shortcuts are independent: choosing one updates only that field and preserves the other value.

**Why:** the user reported that voice buttons overflowed the screen and choosing quick minutes reset the selected hours.

**How to apply:** keep width and flex-shrink constraints in the shared voice-input wrapper, use the shared duration input component for facility and personal shifts, and verify narrow layouts plus hour-then-minute selection.
