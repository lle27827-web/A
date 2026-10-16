# Personal employee notebook

The personal notebook is separate from facility employee view mode. Any signed-in
Clerk account can use `/personal`; anonymous users must sign in. Only the verified
facility owner may change facility records. The personal feature does not grant
facility editing, card access or facility revenue access to other accounts.

Account identity always comes from the verified Clerk request on the server.
Clients never choose an account ID. All service/shift reads and mutations scope
by that identity, and a composite foreign key prevents linking a shift to another
account's service. Personal responses are `private, no-store`; session changes
also discard the browser's previous React Query cache.

Service rates and names are snapshotted when a shift is created. Updating a
service applies to future shifts only. Editing duration/date/notes on the same
service preserves the original name/rate; choosing a different service uses that
service's current rate. Archiving a service preserves past shifts and still
allows editing their existing assignment. Deleting a shift recalculates its
account's daily/monthly totals.

Comparison is read-only: choose a central employee for the same month, then
compare **employee pay**, not customer service charges or facility revenue.
Only own/reference daily and monthly totals and their differences are returned.
Nothing is synchronized or written to the central employee's records.

## Schema and deployment

The additive personal notebook migration creates only `personal_services` and
`personal_sessions`; it neither copies nor deletes facility data.

- Normal initialized development database:
  `pnpm --filter @workspace/db run migrate`
- External Vercel compatibility update:
  `pnpm --filter @workspace/db run migrate:personal-notebook`

The existing Vercel build chain includes the compatibility command. Do not run it
against production without confirming the target and authorization. Historical
baseline support remains intentionally pinned to its previously reviewed range;
do not add the new file's hash to that range automatically.

## Checks

`pnpm --filter @workspace/api-server run test:personal` covers two-account
isolation, attempted cross-account mutations, snapshot rates, archived services,
history and totals, read-only comparison, deletion and high-value pay storage.
`test:auth` checks the personal route's session requirement separately from owner
permissions. The migration suite checks fresh initialization with all releases
and keeps older baseline fixtures isolated.
