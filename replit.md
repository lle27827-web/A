# Cùng Làm

Ứng dụng quản lý thành viên và chấm công: mọi người có thể xem, chỉ chủ sở hữu được phép thay đổi dữ liệu.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm --filter @workspace/task-manager run dev` — run the attendance and member app
- `pnpm run typecheck` — typecheck the workspace
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas after changing OpenAPI
- `pnpm --filter @workspace/db run push` — apply development schema changes
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

The app manages members and attendance with a white background and top search for member names and shifts. Selecting a member shows full shift history. The owner can add/delete members and add/edit/delete attendance after signing in with the configured Clerk account.

The user removed the AI assistant and the Công việc feature. There are no active AI endpoints or voice features. Historical task data remains in the database; do not drop it without explicit permission.

## Gotchas

- Keep `OWNER_EMAIL` unset until the intended owner email is known; the app fails closed and stays read-only.
- Preserve the API proxy route `/api/__clerk` when changing API service routing; Clerk needs it in production.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
