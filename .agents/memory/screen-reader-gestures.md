---
name: Touch save and back gestures
description: The app's limited custom touch gestures and accessibility boundary.
---

Do not build or reintroduce a custom spoken screen-reader/navigation layer in SỔ CÔNG. Preserve accessibility through semantic labels, focus order, and compatibility with the device's native VoiceOver/TalkBack. Keep the optional continuous save/back paths: one uninterrupted up → right → left path submits an ordinary visible form; one uninterrupted left → right path goes back one in-app level, closing the top dialog first. Also allow a stationary 2-second touch anywhere on screen to submit only the active facility or personal attendance form. Direct detail routes fall back to their list before home. Never map save to deletion, card top-ups, database switching, or confirmation actions.

**Why:** the user asked to remove the in-app reader while retaining gesture navigation, then explicitly added 2-second hold-to-save for attendance.

**How to apply:** a long hold may work even when it begins over a field or button, but it must submit only a visible active attendance form. Preserve ordinary taps, standard scrolling, and all destructive/financial-confirmation safeguards. Verify alongside native screen readers on iOS and Android, since the browser cannot override gestures already claimed by the operating system.
