---
name: In-app reader gestures
description: How SỔ CÔNG's optional speech helper should coexist with native screen readers.
---

Treat the optional in-app reader as an additional speech helper, not a replacement for VoiceOver or TalkBack. Keep custom swipe gestures confined to its floating control, and provide clearly named buttons for the same actions. Prefer concise page headings and focused-control labels over reading long descriptions automatically. The save gesture may submit only an open, ordinary save/create/update form; never map it to deletion, card top-ups, database switching, or confirmation actions.

**Why:** the user requested custom in-app gestures, while operating-system screen readers reserve swipes and an ambiguous save gesture must not trigger high-impact actions.

**How to apply:** preserve native reader behavior outside the floating control, retain button/keyboard alternatives, keep the save allowlist narrow, and validate on real mobile assistive-technology setups.
