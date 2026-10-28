# SỔ CÔNG

Ứng dụng quản lý nhân viên, chấm công, dịch vụ và thẻ liệu trình. Ứng dụng dùng Clerk để đăng nhập; chủ sở hữu được xác định từ email đã xác minh trong `ADMIN_EMAIL`, quản lý nhận quyền theo email đã xác minh, và mỗi tài khoản có sổ cá nhân riêng.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm --filter @workspace/task-manager run dev` — run the attendance and member app
- `pnpm run typecheck` — typecheck the workspace
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas after changing OpenAPI
- `pnpm --filter @workspace/db run push` — apply development schema changes
- `pnpm --filter @workspace/api-server run test:massage` — check card balance/payroll transactions with disposable development fixtures
- Managed environment: Replit Database (`DATABASE_URL`)
- Set `ADMIN_EMAIL` in Replit Secrets to the verified email address of the owner account. Never commit the email or Clerk secrets to `.replit` or source control.
- Clerk uses `APP_CLERK_SECRET_KEY` and `APP_CLERK_PUBLISHABLE_KEY`; server authorization is enforced by the API, not by hiding UI controls.

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

- Clerk authentication is required for facility data. The API verifies the signed-in account and its verified email before applying owner or manager permissions. Guests may read only health/auth status endpoints.
- The owner is configured through `ADMIN_EMAIL`; managers receive explicit facility grants. Their permissions and employee scope are enforced server-side.
- Personal attendance, services, pay rates, income and history are scoped to the signed-in account and separate from facility records.
- Attendance work dates are stored as date-only strings to avoid timezone shifts.

## Product

The app is for a massage establishment. “Quản lý thẻ” means customer treatment-package cards, not work-type tags. The user wants customer name, phone number, service type, and usage history recording the date, service duration, and technician who performed each visit.

“Nạp thêm giờ” means adding to the card's available hours, not recording a service visit. It does not change the purchase amount/date or existing payroll. **Why:** the user chose “Nạp thêm giờ vào số dư thẻ”; no implicit paid sale or employee session should be inferred.

The user wants the app named **SỔ CÔNG**, optimized for phone screens. Customer card details must not contain the service wage-price list or unnecessary explanatory prose. New card sales select a type from the configured services, while the card-sale amount remains manually entered and independent of service wage rates. Employee shift-edit actions show customer, service and hours so the correct record can be identified; employee deletion is also available in the employee list. **Why:** these are the user's explicit interface requirements.

The user confirmed: card balances are in hours; card sales are recognized when a customer buys a card; technician wages are customer-service hours × hourly wage. Each service visit is one record shared by card history and employee payroll, not a second wage entry. “Tổng doanh thu cơ sở” is service-session earnings by work date + card-sales amount by purchase date, with separate service and card-sales rows. Exclude archived-card sales, wages and visits from active reports while preserving their saved audit records. Employee removal follows the current-month deletion rules in `deleteMember`; historical records remain and no card minutes are refunded. **Why:** historical payroll, card use and older monthly reports must not be silently rewritten or refunded.

Money is integer VND, duration is integer minutes, and visit earnings are rounded to the nearest VND. The user chose service-catalog hourly rates for employee pay, not customer prices. New attendance requires a catalog service and hours; the service supplies the wage, not the employee's legacy hourlyRate. Each visit snapshots its service name and hourly rate. **Why:** later catalog edits must not silently rewrite past payroll. Editing an existing visit with the same service retains its snapshot, even if its technician changes; deliberately switching service takes the new service's current rate. Existing visits without a catalog reference may retain their historical service/rate when edited. Service types with recorded attendance cannot be deleted through the app.

Use Asia/Ho_Chi_Minh to determine today and the current month. Preserve old attendance and task data; legacy attendance is not included in service-based wages. Nonowners receive masked customer phone numbers from the server, not just a CSS mask. Removing a card from the active list preserves its attendance and use-history records.

The user wants the app named “Số công” and two views, Chủ and Nhân viên, both with black backgrounds and white text. Keep search at the top and use “Nhân viên” rather than “Thành viên” in the interface. The home screen contains search, employee management on the left, customer-card management on the right, and current-month facility revenue with service/card breakdown. Card management also has a visible search by customer name or phone; preserve server phone masking for viewers. Search results must appear first below the header on every route, including card management, before page content or notices. Opening a result clears the query; the customer detail return action goes home with no old search results. **Why:** the user explicitly wants results at the top and a clean main screen after returning from a searched customer.

Clicking an employee first offers “Chấm công” and “Xem chi tiết”: quick attendance selects a service and hours. Employee details are compact: monthly salary first, selected-day salary second with small service-count notes, then full-width day rows stacked vertically, Vietnam today first. Each day row shows date, total session count and total saved earnings only, including zero for empty days; do not show service names, hours or session records outside a clicked day's detail panel. All day panels start collapsed, even today. Tapping a day selects it for daily salary and opens/closes its recorded service types, hours and notes directly below that row. Put smaller owner-only “Chỉnh sửa” and “Chấm công” actions below those records, not above the dates. Avoid extra explanatory employee-content blocks, avatars or legacy-attendance sections; retain historical data in the database. Employee details include a top-left return action even in employee-view preview. **Why:** the user requested only salary summaries and day totals until they explicitly tap to inspect or edit recorded sessions. Service catalog management is accessible from settings. The gear also selects the view and employee displayed in the employee view, with the selection remembered in the current browser.

Facility permissions are account-based, not presentation modes. A signed-in owner has full access; managers receive only the rights and employee scope granted to them. Personal notebooks are private to the corresponding Clerk account.

The current app has no active AI endpoints, voice features, or Công việc feature. Historical task data remains in the database; do not drop it without explicit permission.

## Gotchas

- Never bypass Clerk verification or the API's owner/manager authorization checks. Keep `ADMIN_EMAIL` in Replit Secrets and configure the corresponding environment variables in Vercel separately.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
