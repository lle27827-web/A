# Số công

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

Money is integer VND, duration is integer minutes, and visit earnings are rounded to the nearest VND. The user chose service-catalog hourly rates for employee pay, not customer prices. New attendance requires a catalog service and hours; the service supplies the wage, not the employee's legacy hourlyRate. Each visit snapshots its service name and hourly rate. **Why:** later catalog edits must not silently rewrite past payroll. Editing an existing visit with the same service retains its snapshot, even if its technician changes; deliberately switching service takes the new service's current rate. Existing visits without a catalog reference may retain their historical service/rate when edited. Service types with recorded attendance cannot be deleted through the app.

Use Asia/Ho_Chi_Minh to determine today and the current month. Preserve old attendance and task data; legacy attendance is not included in service-based wages. Nonowners receive masked customer phone numbers from the server, not just a CSS mask. Used cards cannot be deleted while usage records remain.

The user wants the app named “Số công” and two views, Chủ and Nhân viên, both with black backgrounds and white text. Keep search at the top and use “Nhân viên” rather than “Thành viên” in the interface. The home screen contains search, employee management on the left, customer-card management on the right, and current-month card-sales revenue. Clicking an employee first offers “Chấm công” and “Xem chi tiết”: quick attendance selects a service and hours; details retain monthly salary and the day calendar, Vietnam today first. Service catalog management is accessible from settings. The gear also selects the view and employee displayed in the employee view, with the selection remembered in the current browser.

Choosing the Chủ view is a presentation preference, never authorization. Only the verified owner account may edit in that view; the Nhân viên view is read-only even when previewed by the owner. Employee selection is a display filter, not a private employee-account access boundary: the existing public-read policy remains unchanged.

Selecting an employee shows shift history. The owner can add/delete employees and add/edit/delete attendance after signing in with the configured Clerk account. The current app has no active AI endpoints, voice features, or Công việc feature. Historical task data remains in the database; do not drop it without explicit permission.

## Gotchas

- Keep `OWNER_EMAIL` unset until the intended owner email is known; the app fails closed and stays read-only.
- Preserve the API proxy route `/api/__clerk` when changing API service routing; Clerk needs it in production.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
