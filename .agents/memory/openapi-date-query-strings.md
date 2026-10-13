---
name: OpenAPI date query strings
description: Avoid date-format parameters becoming server-side Date validators for URL query strings.
---

OpenAPI query parameters arrive through Express as strings. Do not declare a date-format query parameter if the generated Zod validator expects a `Date` instance instead of parsing the URL text. Use a string schema that validates the `YYYY-MM-DD` shape, then validate that the calendar date itself is real at the server boundary.

**Why:** Orval's generated schema for an OpenAPI `string` with `format: date` was `z.date()`. A normal query string then failed validation with HTTP 400 and the dashboard could not show its summary.

**How to apply:** whenever adding date-based filters, verify the generated schema accepts actual URL text and test a complete query such as `?date=2026-10-13`.
