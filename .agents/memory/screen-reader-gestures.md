---
name: Touch save and back gestures
description: The app's limited custom touch gestures and accessibility boundary.
---

Do not build or reintroduce a custom spoken screen-reader/navigation layer in SỔ CÔNG. Preserve accessibility through semantic labels, focus order, and compatibility with the device's native VoiceOver/TalkBack. Keep the app's optional continuous touch gestures: one uninterrupted up → right → left path submits only an ordinary visible form; one uninterrupted left → right path goes back one in-app level, closing the top dialog first. Direct detail routes fall back to their list before home. Never map save to deletion, card top-ups, database switching, or confirmation actions.

**Why:** the user asked to remove the in-app reader while retaining only the continuous save and back gestures.

**How to apply:** keep the gesture toggle in Settings; ignore ordinary taps, text-entry controls, standard scrolling, and ambiguous paths. Verify gesture behavior alongside native screen readers on iOS and Android, since the browser cannot override gestures already claimed by the operating system.
