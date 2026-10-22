---
name: In-app reader gestures
description: How SỔ CÔNG's optional speech helper should coexist with native screen readers.
---

Treat the optional in-app reader as an additional speech/navigation helper, not a replacement for VoiceOver or TalkBack. Its opt-in touch mode uses one-finger swipes to move virtual focus. Every single tap selects and reads the focusable target under that touch position; a second tap anywhere within the double-tap window activates the target selected by the first tap, without moving focus to the second tap location. Two-finger vertical drags scroll the nearest app scroll container. Keep this mode independently switchable because the operating system may intercept or conflict with gestures; preserve keyboard and mouse access. Prefer concise headings and focused-control labels over long descriptions. The save gesture may submit only an open, ordinary save/create/update form; never map it to deletion, card top-ups, database switching, or confirmation actions.

**Why:** the user wants touch exploration to choose the item under the first tap, while double-tap must activate that selection even if the second tap lands elsewhere; a separate toggle keeps normal touch interaction available when native assistive technology takes precedence.

The browser speech API only controls speech it creates; it cannot set VoiceOver/TalkBack volume or reliably observe native accessibility focus. The app cannot guarantee control over gestures already captured by the operating system, so real-device testing is required. Provide an auto-read toggle and explicit focus/read buttons so users can avoid duplicate speech and still navigate with the app helper.

**Why:** web pages do not have platform APIs for changing native screen-reader output or observing its focus consistently.

**How to apply:** distinguish helper volume from device screen-reader volume, retain manual navigation, preserve a switch to turn custom touch interception off, make tap activation use the persistent focus cursor, and verify double-tap, one-finger focus navigation, and two-finger scrolling on real mobile assistive-technology setups.

Single upward swipe in the app helper goes back one in-app level, closing an open dialog first; it must not return from home to the last page. A direct employee/card detail link falls back to its list before home. Keep the shortcuts fixed to up-then-down → Employees and down-then-up → Cards, with enough time to perform both swipes, and offer only Vietnamese speech voices.

**Why:** the user confirmed this shortcut mapping and asked for sequential, non-looping return navigation and Vietnamese-only reading.

**How to apply:** preserve the history stack when changing routes, clear it when explicitly returning home, and keep the Vietnamese locale on the utterance even when the device has no Vietnamese voice installed.
