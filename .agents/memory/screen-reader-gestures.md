---
name: In-app reader gestures
description: How SỔ CÔNG's optional speech helper should coexist with native screen readers.
---

Treat the optional in-app reader as an additional speech/navigation helper, not a replacement for VoiceOver or TalkBack. Keep custom swipes confined to its floating control; horizontal swipes may move DOM focus through visible page or active-dialog elements. Let the operating-system screen reader handle double-tap activation, and provide clearly named buttons for helper actions. Prefer concise headings and focused-control labels over long descriptions. The save gesture may submit only an open, ordinary save/create/update form; never map it to deletion, card top-ups, database switching, or confirmation actions.

**Why:** the user requested custom in-app gestures, while operating-system screen readers reserve swipes and an ambiguous save gesture must not trigger high-impact actions.

**How to apply:** preserve native reader behavior outside the floating control, retain button/keyboard alternatives, keep the save allowlist narrow, and validate on real mobile assistive-technology setups.
