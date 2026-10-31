---
name: Theme profiles
description: Product requirements for keeping the built-in SỔ CÔNG themes independent from user-created color customization.
---

Keep the built-in yellow and dark-brown themes as separate defaults. Users may edit either preset only through its explicit edit action; opening the general color editor creates/edits a third, independent custom theme.

All application text and numbers are bold. Employee-creation and card-creation buttons use dark brown with light text. The personal timesheet keeps the yellow canvas in the yellow theme and uses brown for its card surfaces in both themes; its canvas is brown in dark mode. Personal content text is bold white on brown surfaces. Home management shortcuts are white, return controls are dark green, and the global search field is dark brown with light text. Editable fields are white except service-selection controls, which are brown; employee attendance/detail choices and employee/card list surfaces are brown with light text. Destructive actions retain red text and borders.

**Why:** The user wants custom color choices not to overwrite or unexpectedly alter the two built-in interfaces, specified consistent bold text, and gave specific color choices for navigation, form fields, service selection, and employee/card lists.

**How to apply:** When changing theme selection, palette storage, or theme controls, preserve independent palettes for the yellow, dark-brown, and custom profiles; keep reset actions scoped to the active profile. Keep all app text and numbers bold; employee/card creation actions dark brown, home shortcuts white, return controls green, global search brown, other editable fields white, service-selection controls and employee/card list surfaces brown, and destructive actions red.
