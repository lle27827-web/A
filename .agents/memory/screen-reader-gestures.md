---
name: In-app reader gestures
description: How SỔ CÔNG's optional speech helper should coexist with native screen readers.
---

Treat the optional in-app reader as an additional speech/navigation helper, not a replacement for VoiceOver or TalkBack. Keep custom swipes confined to its floating control; horizontal swipes may move DOM focus through visible page or active-dialog elements. Let the operating-system screen reader handle double-tap activation, and provide clearly named buttons for helper actions. Prefer concise headings and focused-control labels over long descriptions. The save gesture may submit only an open, ordinary save/create/update form; never map it to deletion, card top-ups, database switching, or confirmation actions.

**Why:** the user requested custom in-app gestures, while operating-system screen readers reserve swipes and an ambiguous save gesture must not trigger high-impact actions.

The browser speech API only controls speech it creates; it cannot set VoiceOver/TalkBack volume or reliably observe native accessibility focus. Provide an auto-read toggle and explicit focus/read buttons so users can avoid duplicate speech and still navigate with the app helper.

**Why:** web pages do not have platform APIs for changing native screen-reader output or observing its focus consistently.

**How to apply:** distinguish helper volume from device screen-reader volume, retain manual navigation, and verify on real mobile assistive-technology setups.
