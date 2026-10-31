---
name: Theme profiles
description: Product requirements for keeping the built-in SỔ CÔNG themes independent from user-created color customization.
---

Keep the built-in yellow and dark-brown themes as separate defaults. Users may edit either preset only through its explicit edit action; opening the general color editor creates/edits a third, independent custom theme.

The personal timesheet keeps the yellow canvas in the yellow theme and uses brown for its card surfaces in both themes; its canvas is brown in dark mode. Personal content text is bold white on brown surfaces. Functional controls are generally white, except home shortcuts and return navigation, which are dark green; employee attendance/detail choices and employee/card list surfaces are brown with light text. Destructive actions retain red text and borders.

**Why:** The user wants custom color choices not to overwrite or unexpectedly alter the two built-in interfaces, and gave specific color choices for the home shortcuts, return navigation, and employee/card lists.

**How to apply:** When changing theme selection, palette storage, or theme controls, preserve independent palettes for the yellow, dark-brown, and custom profiles; keep reset actions scoped to the active profile. Preserve the dark-green home/return controls and brown employee/card list surfaces; retain red text/borders for destructive actions.
