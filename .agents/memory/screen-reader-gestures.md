---
name: In-app reader gestures
description: How SỔ CÔNG's optional speech helper should coexist with native screen readers.
---

Treat the optional in-app reader as an additional speech/navigation helper, not a replacement for VoiceOver or TalkBack. In opt-in touch mode, tapping or slowly dragging one finger selects and reads the focusable target under the finger; a quick second tap anywhere activates the persistent focus from the first tap without moving it to the second tap location. A continuous inverted-V stroke (up then down) opens Employees; a continuous V stroke (down then up) opens Cards. Two-finger vertical drags scroll the nearest app scroll container. Keep this mode independently switchable because the operating system may intercept or conflict with gestures; preserve keyboard and mouse access. Prefer concise headings and focused-control labels over long descriptions. The save gesture may submit only an open, ordinary save/create/update form; never map it to deletion, card top-ups, database switching, or confirmation actions.

**Why:** touch exploration must work independently from the double-tap activation gesture, and the user specifically wants the two opposite V-shaped shortcuts to be a single continuous path rather than two separate swipes.

The browser speech API only controls speech it creates; it cannot set VoiceOver/TalkBack volume or reliably observe native accessibility focus. The app cannot guarantee control over gestures already captured by the operating system, so real-device testing is required. Provide an auto-read toggle and explicit focus/read buttons so users can avoid duplicate speech and still navigate with the app helper.

**Why:** web pages do not have platform APIs for changing native screen-reader output or observing its focus consistently.

**How to apply:** distinguish helper volume from device screen-reader volume, retain manual navigation, preserve a switch to turn custom touch interception off, activate from the persistent focus cursor, and verify touch exploration, double-tap, V strokes, and two-finger scrolling on real mobile assistive-technology setups.

Single upward swipe in the app helper goes back one in-app level, closing an open dialog first; it must not return from home to the last page. A direct employee/card detail link falls back to its list before home. Keep continuous up-then-down inverted-V → Employees and down-then-up V → Cards, and offer only Vietnamese speech voices.

**Why:** the user confirmed this shortcut mapping and asked for sequential, non-looping return navigation and Vietnamese-only reading.

**How to apply:** preserve the history stack when changing routes, clear it when explicitly returning home, and keep the Vietnamese locale on the utterance even when the device has no Vietnamese voice installed.
