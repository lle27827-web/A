# Threat Model

## Project Overview

Sổ Công is a multi-business attendance, customer-card, appointment, service-pricing, reporting, and personal-work-history application. The web client is React/Vite, the API is Express, identity is verified through Clerk, and business data is stored in three shared Neon PostgreSQL stores partitioned by data domain. The target layout keeps facility attendance on DB1, cards/history on DB2, and personal/shared data plus the business registry and partition coordinator on DB3. DB4 remains a migration source until its data is copied and verified. Personal notebooks are account-scoped and separate from business records.

## Assets

- **Business records and customer PII** — employee attendance and pay, customer names and phone numbers, treatment cards and top-ups, appointments, service pricing, and revenue reports. Cross-business disclosure or writes can expose private customer/employee information or corrupt financial records.
- **Business identity and access settings** — business names, join-code hashes, memberships, roles, delegated grants, and print profile fields (name, address, tax code, and phone). A leaked or mis-scoped record could let an account join or impersonate another business, or print the wrong business identity.
- **Personal notebooks** — each account’s attendance, rates, income, and history. These must remain private even when the account is also a business owner or employee.
- **Authentication and infrastructure secrets** — Clerk signing/configuration values and PostgreSQL connection strings. They must remain server-side and must never appear in client bundles, responses, or logs.
- **Audit and idempotency records** — tenant-scoped mutation history and request deduplication state, needed to prevent duplicate writes and to explain important business changes.

## Trust Boundaries

- **Browser to API:** the browser supplies an authenticated Clerk token and may select a business. The selected business identifier is untrusted until the API confirms active membership; the client never receives database credentials.
- **API to PostgreSQL:** the API has access to the three runtime stores. Tenant isolation is enforced by verified server-side business scope and `business_id` predicates, not by hiding UI controls. The business registry and membership data are stored on DB3.
- **Owner to employee/manager:** owners may manage their active business; employees and managers receive only server-verified grants. The personal notebook is a separate authorization scope.
- **Production to development:** Vercel and Replit use distinct environment configurations. A development test must not be pointed at production data, and a deployment migration must be additive and verified against each configured store.
- **Print output boundary:** business and customer details are rendered in the browser and passed to the browser’s print dialog. Only the currently selected business’s identity may be used; customer values must be escaped before rendering.

## Scan Anchors

- API entry and authorization gate: `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/lib/owner-auth.ts`.
- Tenant identity and membership: `artifacts/api-server/src/lib/business-tenancy.ts`, `artifacts/api-server/src/routes/businesses.ts`.
- Business data access: `artifacts/api-server/src/routes/` and `artifacts/api-server/src/lib/`; facility tables and tenant indexes are defined under `lib/db/src/schema/`.
- Four-store migration and preflight checks: `lib/db/scripts/apply-business-tenancy.mjs`, `lib/db/scripts/verify-vercel-stores.mjs`.
- Print preferences and output: `artifacts/task-manager/src/lib/printing.ts`, `artifacts/task-manager/src/components/view-settings.tsx`.
- The component-preview artifact under `artifacts/mockup-sandbox/` is not a production API surface.

## Threat Categories

### Spoofing

An attacker could forge a business selection or claim another user’s identity. Every facility API request MUST use a verified Clerk identity and resolve the selected business through an active membership. A business ID, email, role, or owner claim supplied by the browser MUST NOT grant access by itself. Join codes MUST remain hashed and rate-limited.

### Tampering

An employee could submit altered prices, owner-only settings, IDs from another business, or forged attendance/card changes. The server MUST validate request bodies and derive business scope, ownership, prices, and permissions from trusted records. Every read and mutation on a business table MUST include the verified business scope. Print-profile updates MUST require the verified owner of that same active business.

### Repudiation

Duplicate or disputed financial and employee mutations require an idempotency record and a tenant-scoped audit entry committed with the mutation. Audit records MUST contain only the actor and minimum operational before/after values; customer names, phone numbers, and unrelated personal data MUST NOT be copied into them.

### Information Disclosure

The highest-risk exposure is cross-business access to customer phone numbers, cards, appointments, attendance, employee pay, or print identity. Authenticated responses MUST be scoped to the active membership and use private/no-store caching where they contain business identity or customer data. Business print identity MUST be stored on the server per business; device print settings and employee-specific shortcut labels MUST be scoped by user and business. Facility phone numbers MUST NOT be persisted in unscoped local storage or logged. Personal notebooks MUST be scoped to the verified account ID.

### Denial of Service

Public business creation and join-code endpoints can be abused to consume database capacity or brute-force codes. Keep rate limits, bounded request validation, connection timeouts, and fail-closed behavior for registry or permission-store failures. A DB3 coordinator outage can make business authorization unavailable; personal notebooks may remain available, but the API MUST NOT grant stale business access as a fallback. The planned DB4→DB3 data copy has not been executed or verified, so do not deploy the three-store runtime against live data until cutover checks pass.

### Elevation of Privilege

A member could attempt to call owner or manager operations directly or alter client-side role state. All role and grant checks MUST be enforced in the API for every request. Owner-only settings and permission changes MUST use the server-verified owner identity; a client-side role selector is presentation state only. No route may fall back to a shared default business when the authenticated business scope is absent or invalid.
