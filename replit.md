# Cùng Làm

Ứng dụng chia sẻ danh sách công việc: mọi người có thể xem, chỉ chủ sở hữu được phép thay đổi dữ liệu.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm --filter @workspace/task-manager run dev` — run the task manager
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

- `artifacts/task-manager` — Vietnamese task-management web app
- `artifacts/api-server` — shared API and server-side owner permission checks
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/db/src/schema/tasks.ts` — persistent task data model

## Architecture decisions

- Task reads are public; every create, update, and delete is protected by server-side owner authorization.
- Owner authorization matches a verified Clerk email to `OWNER_EMAIL`; it is never claimed by the first visitor.
- Calendar due dates are stored as date-only strings to avoid timezone shifts.

## Product

The public task board supports search, status and priority filters, task summaries, due dates, and clear read-only access. The owner can add, edit, complete, reopen, or delete tasks after signing in with the configured Clerk account. Demo content is labeled as an example.

## Gotchas

- Keep `OWNER_EMAIL` unset until the intended owner email is known; the app fails closed and stays read-only.
- Preserve the API proxy route `/api/__clerk` when changing API service routing; Clerk needs it in production.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
