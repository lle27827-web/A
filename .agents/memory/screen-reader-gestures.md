---
name: In-app reader gestures
description: How SỔ CÔNG's optional speech helper should coexist with native screen readers.
---

Treat the optional in-app reader as an additional speech/navigation helper, not a replacement for VoiceOver or TalkBack. Its opt-in touch mode uses one-finger swipes to move virtual focus; when focus exists, double-tapping anywhere activates that focused element, never whichever element is under the second tap. If there is no focus yet, one tap may establish the initial focus. Two-finger vertical drags scroll the nearest app scroll container. Keep this mode independently switchable because the operating system may intercept or conflict with gestures; preserve keyboard and mouse access. Prefer concise headings and focused-control labels over long descriptions. The save gesture may submit only an open, ordinary save/create/update form; never map it to deletion, card top-ups, database switching, or confirmation actions.

**Why:** the user explicitly requested full-screen gestures and clarified that double-tap must act on the current focus, not the finger position; a separate toggle keeps normal touch interaction available when native assistive technology takes precedence.

The browser speech API only controls speech it creates; it cannot set VoiceOver/TalkBack volume or reliably observe native accessibility focus. The app cannot guarantee control over gestures already captured by the operating system, so real-device testing is required. Provide an auto-read toggle and explicit focus/read buttons so users can avoid duplicate speech and still navigate with the app helper.

**Why:** web pages do not have platform APIs for changing native screen-reader output or observing its focus consistently.

**How to apply:** distinguish helper volume from device screen-reader volume, retain manual navigation, preserve a switch to turn custom touch interception off, make tap activation use the persistent focus cursor, and verify double-tap, one-finger focus navigation, and two-finger scrolling on real mobile assistive-technology setups.
