---
name: Theme profiles
description: Product requirements for keeping the built-in SỔ CÔNG themes independent from user-created color customization.
---

Keep the built-in yellow and dark-brown themes as separate defaults. Users may edit either preset only through its explicit edit action; opening the general color editor creates/edits a third, independent custom theme.

The personal timesheet keeps the yellow canvas in the yellow theme and uses brown for its card surfaces in both themes; its canvas is brown in dark mode. Personal content text is bold white on brown surfaces. Functional buttons throughout the home screen, navigation, settings, facility, and personal views use white backgrounds; destructive actions retain red text and borders.

**Why:** The user wants custom color choices not to overwrite or unexpectedly alter the two built-in interfaces, and requested white functional-button surfaces throughout the app.

**How to apply:** When changing theme selection, palette storage, or theme controls, preserve independent palettes for the yellow, dark-brown, and custom profiles; keep reset actions scoped to the active profile. Keep action buttons white in all views and retain red text/borders for destructive actions.
