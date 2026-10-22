---
name: In-app reader gestures
description: How SỔ CÔNG's optional speech helper should coexist with native screen readers.
---

Treat the optional in-app reader as an additional speech/navigation helper, not a replacement for VoiceOver or TalkBack. In opt-in touch mode, tapping or slowly dragging one finger selects and reads the focusable target under the finger; a quick second tap anywhere activates the persistent focus from the first tap without moving it to the second tap location. A continuous inverted-V stroke (up then down) opens Cards; a continuous V stroke (down then up) opens Employees. Two-finger vertical drags scroll the nearest app scroll container. A downward swipe submits a safe open form, or advances focus when no form is available. Keep this mode independently switchable because the operating system may intercept or conflict with gestures; preserve keyboard and mouse access. Prefer concise headings and focused-control labels over long descriptions. The save gesture may submit only an open, ordinary save/create/update form; never map it to deletion, card top-ups, database switching, or confirmation actions.

**Why:** touch exploration must work independently from double-tap activation. The user’s current mapping is continuous up-then-down inverted-V → Cards and down-then-up V → Employees; when no safe form is open, downward navigation should advance the current focus so revenue rows can be read.

When a native editable control is under the finger, do not prevent its touch events or route them through the helper. Let the device keyboard and operating-system screen reader handle entry; the in-app reader can announce the field label and current non-password value on focus, but must never read a password value.

**Why:** the user chose the safer native-keyboard approach so editing, field switching, and device-level key announcements remain available.

The browser speech API only controls speech it creates; it cannot set VoiceOver/TalkBack volume or reliably observe native accessibility focus. The app cannot guarantee control over gestures already captured by the operating system, so real-device testing is required. Provide an auto-read toggle and explicit focus/read buttons so users can avoid duplicate speech and still navigate with the app helper.

**Why:** web pages do not have platform APIs for changing native screen-reader output or observing its focus consistently.

**How to apply:** distinguish helper volume from device screen-reader volume, retain manual navigation, preserve a switch to turn custom touch interception off, activate from the persistent focus cursor, keep visible revenue rows in the focus order, and verify touch exploration, double-tap, V strokes, and two-finger scrolling on real mobile assistive-technology setups.

Single upward swipe in the app helper goes back one in-app level, closing an open dialog first; it must not return from home to the last page. A direct employee/card detail link falls back to its list before home. Keep continuous up-then-down inverted-V → Cards and down-then-up V → Employees, and offer only Vietnamese speech voices.

**Why:** the user asked for sequential, non-looping return navigation and Vietnamese-only reading.

**How to apply:** preserve the history stack when changing routes, clear it when explicitly returning home, and keep the Vietnamese locale on the utterance even when the device has no Vietnamese voice installed.
