# Cùng Làm

Ứng dụng quản lý nhân viên và chấm công: mọi người có thể xem, chỉ chủ sở hữu được phép thay đổi dữ liệu.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm --filter @workspace/task-manager run dev` — run the attendance and member app
- `pnpm run typecheck` — typecheck the workspace
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas after changing OpenAPI
- `pnpm --filter @workspace/db run push` — apply development schema changes
- `pnpm --filter @workspace/api-server run test:massage` — check card balance/payroll transactions with disposable development fixtures
- Managed environment: Replit Database (`DATABASE_URL`) and Clerk Auth
- Required owner configuration: `OWNER_EMAIL` — the owner's verified Clerk email. Until configured, all write operations remain disabled.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/task-manager` — Vietnamese member and attendance web app
- `artifacts/api-server` — shared API and server-side owner permission checks
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/db/src/schema` — persistent members and attendance; historical task data is retained

## Architecture decisions

- Member and attendance reads are public; every create, update, and delete is protected by server-side owner authorization.
- Owner authorization matches a verified Clerk email to `OWNER_EMAIL`; it is never claimed by the first visitor.
- Attendance work dates are stored as date-only strings to avoid timezone shifts.

## Product

The app is for a massage establishment. “Quản lý thẻ” means customer treatment-package cards, not work-type tags. The user wants customer name, phone number, service type, and usage history recording the date, service duration, and technician who performed each visit.

The user confirmed: card balances are in hours; monthly revenue is recognized when a customer buys a card; technician wages are hours serving customers × hourly wage, not attendance clock hours. One service visit is shared by card usage history and employee payroll; never create a second wage record for the same visit.

Money is integer VND, duration is integer minutes, and visit earnings are rounded to the nearest VND. Each visit snapshots the technician's hourly wage, so later rate changes do not silently rewrite historical wages. **Why:** past payroll must remain stable when a future hourly wage changes. Changing the visit's technician intentionally takes the new technician's current rate.

Use Asia/Ho_Chi_Minh to determine today and the current month. Preserve old attendance and task data; legacy attendance is not included in service-based wages. Nonowners receive masked customer phone numbers from the server, not just a CSS mask. Used cards cannot be deleted while usage records remain.

The user wants two views, Chủ and Nhân viên, both with black backgrounds and white text. Keep search at the top and use “Nhân viên” rather than “Thành viên” in the interface. The home screen only contains search, employee management on the left, customer-card management on the right, and current-month card-sales revenue. Opening an employee leads to a separate screen with monthly salary first and a horizontal day selector below; Vietnam today is first in the current month. A settings gear selects the view and the employee displayed in the employee view, with the selection remembered on the current browser.

Choosing the Chủ view is a presentation preference, never authorization. Only the verified owner account may edit in that view; the Nhân viên view is read-only even when previewed by the owner. Employee selection is a display filter, not a private employee-account access boundary: the existing public-read policy remains unchanged.

Selecting an employee shows shift history. The owner can add/delete employees and add/edit/delete attendance after signing in with the configured Clerk account. The current app has no active AI endpoints, voice features, or Công việc feature. Historical task data remains in the database; do not drop it without explicit permission.

## Gotchas

- Keep `OWNER_EMAIL` unset until the intended owner email is known; the app fails closed and stays read-only.
- Preserve the API proxy route `/api/__clerk` when changing API service routing; Clerk needs it in production.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
