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

Do not show note inputs or note rows on the application's screens. Facility and personal attendance use separate whole-hour and minute inputs; new shifts default to 1 hour and 0 minutes, with quick choices for 30 minutes, 1 hour, 2 hours and 3 hours.

**Why:** the user explicitly asked to remove every note row, then requested a separate minutes input and quick duration choices in both attendance forms.

**How to apply:** removing note UI is not permission to erase previously stored notes. Preserve hidden note data when editing unrelated fields; validate the combined duration from 1 minute to 24 hours and retain exact minutes when editing a shift.
