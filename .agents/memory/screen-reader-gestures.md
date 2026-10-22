---
name: In-app reader gestures
description: How SỔ CÔNG's optional speech helper should coexist with native screen readers.
---

Treat the optional in-app reader as an additional speech/navigation helper, not a replacement for VoiceOver or TalkBack. Its opt-in touch mode may use one-finger taps/swipes across the app for virtual focus, double-tap activation, and focus navigation, while two-finger vertical drags scroll the nearest app scroll container. Keep this mode independently switchable because the operating system may intercept or conflict with gestures; preserve keyboard and mouse access. Prefer concise headings and focused-control labels over long descriptions. The save gesture may submit only an open, ordinary save/create/update form; never map it to deletion, card top-ups, database switching, or confirmation actions.

**Why:** the user explicitly requested full-screen custom touch gestures matching a screen-reader pattern; a separate toggle keeps normal touch interaction available when native assistive technology takes precedence.

The browser speech API only controls speech it creates; it cannot set VoiceOver/TalkBack volume or reliably observe native accessibility focus. The app cannot guarantee control over gestures already captured by the operating system, so real-device testing is required. Provide an auto-read toggle and explicit focus/read buttons so users can avoid duplicate speech and still navigate with the app helper.

**Why:** web pages do not have platform APIs for changing native screen-reader output or observing its focus consistently.

**How to apply:** distinguish helper volume from device screen-reader volume, retain manual navigation, preserve a switch to turn custom touch interception off, and verify double-tap, one-finger focus navigation, and two-finger scrolling on real mobile assistive-technology setups.
