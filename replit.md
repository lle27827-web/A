# SỔ CÔNG

Ứng dụng quản lý nhân viên và chấm công: mọi người có thể xem; chủ sở hữu và người được chủ sở hữu cấp quyền quản lý được phép thay đổi dữ liệu.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm --filter @workspace/task-manager run dev` — run the attendance and member app
- `pnpm run typecheck` — typecheck the workspace
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas after changing OpenAPI
- `pnpm --filter @workspace/db run push` — apply development schema changes
- `pnpm --filter @workspace/api-server run test:massage` — check card balance/payroll transactions with disposable development fixtures
- Managed environment: Replit Database (`DATABASE_URL`) and Clerk Auth
- Required owner configuration: `ADMIN_EMAIL` — the owner's verified Clerk email. Until configured, all write operations remain disabled.

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

- Business-data reads are public; every create, update, and delete requires server-side authorization as the owner or a delegated manager. The manager grant list and grant/revoke operations are private to the owner.
- Owner authorization matches a verified Clerk email to `ADMIN_EMAIL`; it is never claimed by the first visitor.
- Attendance work dates are stored as date-only strings to avoid timezone shifts.

Only the primary owner may grant or revoke management access. Managers may add/edit/delete business data, but may not grant access to others or change the owner. Matching uses verified Clerk email addresses; revocation is checked on every new write request. Employee-view preview remains read-only regardless of account rights. **Why:** the user explicitly chose “Chỉ chủ sở hữu được cấp hoặc thu hồi quyền quản lý.”

## Product

The app is for a massage establishment. “Quản lý thẻ” means customer treatment-package cards, not work-type tags. The user wants customer name, phone number, service type, and usage history recording the date, service duration, and technician who performed each visit.

“Nạp thêm giờ” means adding to the card's available hours, not recording a service visit. It does not change the purchase amount/date or existing payroll. **Why:** the user chose “Nạp thêm giờ vào số dư thẻ”; no implicit paid sale or employee session should be inferred.

The user wants the app named **SỔ CÔNG**, optimized for phone screens. Customer card details must not contain the service wage-price list or unnecessary explanatory prose. New card sales select a type from the configured services, while the card-sale amount remains manually entered and independent of service wage rates. Employee shift-edit actions show customer, service and hours so the correct record can be identified; employee deletion is also available in the employee list. **Why:** these are the user's explicit interface requirements.

The user confirmed: card balances are in hours; card sales are recognized when a customer buys a card; technician wages are customer-service hours × hourly wage. Each service visit is one record shared by card history and employee payroll, not a second wage entry. “Tổng doanh thu cơ sở” is service-session earnings by work date + card-sales amount by purchase date, with separate service and card-sales rows. Exclude archived-card sales, wages and visits from active reports while preserving their saved audit records; deleting an employee permanently deletes that employee's shifts and wages. **Why:** the user explicitly asked for deleted items to stop contributing to revenue/payroll. Existing archived-card records also must not be dropped as a schema migration side effect.

Money is integer VND, duration is integer minutes, and visit earnings are rounded to the nearest VND. The user chose service-catalog hourly rates for employee pay, not customer prices. New attendance requires a catalog service and hours; the service supplies the wage, not the employee's legacy hourlyRate. Each visit snapshots its service name and hourly rate. **Why:** later catalog edits must not silently rewrite past payroll. Editing an existing visit with the same service retains its snapshot, even if its technician changes; deliberately switching service takes the new service's current rate. Existing visits without a catalog reference may retain their historical service/rate when edited. Service types with recorded attendance cannot be deleted through the app.

Use Asia/Ho_Chi_Minh to determine today and the current month. Preserve old attendance and task data; legacy attendance is not included in service-based wages. Nonowners receive masked customer phone numbers from the server, not just a CSS mask. Used cards cannot be deleted while usage records remain.

The user wants the app named “Số công” and two views, Chủ and Nhân viên, both with black backgrounds and white text. Keep search at the top and use “Nhân viên” rather than “Thành viên” in the interface. The home screen contains search, employee management on the left, customer-card management on the right, and current-month facility revenue with service/card breakdown. Card management also has a visible search by customer name or phone; preserve server phone masking for viewers. Search results must appear first below the header on every route, including card management, before page content or notices. Opening a result clears the query; the customer detail return action goes home with no old search results. **Why:** the user explicitly wants results at the top and a clean main screen after returning from a searched customer.

Clicking an employee first offers “Chấm công” and “Xem chi tiết”: quick attendance selects a service and hours. Employee details are compact: monthly salary first, selected-day salary second with small service-count notes, then full-width day rows stacked vertically, Vietnam today first. Each day row shows date, total session count and total saved earnings only, including zero for empty days; do not show service names, hours or session records outside a clicked day's detail panel. All day panels start collapsed, even today. Tapping a day selects it for daily salary and opens/closes its recorded service types, hours and notes directly below that row. Put smaller owner-only “Chỉnh sửa” and “Chấm công” actions below those records, not above the dates. Avoid extra explanatory employee-content blocks, avatars or legacy-attendance sections; retain historical data in the database. Employee details include a top-left return action even in employee-view preview. **Why:** the user requested only salary summaries and day totals until they explicitly tap to inspect or edit recorded sessions. Service catalog management is accessible from settings. The gear also selects the view and employee displayed in the employee view, with the selection remembered in the current browser.

Choosing the Chủ view is a presentation preference, never authorization. Only a verified owner or delegated manager may edit in that view; the Nhân viên view is read-only even when previewed by either. Employee selection is a display filter, not a private employee-account access boundary: the existing public-read policy remains unchanged.

Selecting an employee shows shift history. The owner can add/delete employees and add/edit/delete attendance after signing in with the configured Clerk account. The current app has no active AI endpoints, voice features, or Công việc feature. Historical task data remains in the database; do not drop it without explicit permission.

## Gotchas

- Keep `ADMIN_EMAIL` unset until the intended owner email is known; the app fails closed and stays read-only.
- Preserve the API proxy route `/api/__clerk` when changing API service routing; Clerk needs it in production.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
