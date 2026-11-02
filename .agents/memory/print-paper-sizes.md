---
name: Print paper sizes
description: Browser page-size requirements for the print-slip feature.
---

Use explicit valid width-and-height dimensions for thermal receipt layouts. A width paired with `auto` in the CSS `@page` size descriptor may be rejected silently, causing the printer to fall back to another paper size.

**Why:** The print dialog depends on browser CSS Paged Media support; a silently ignored size makes the selected thermal format unreliable.

**How to apply:** When adding or changing printer formats, validate the generated `@page` size string and keep the preview aspect ratio in sync with the physical dimensions.
