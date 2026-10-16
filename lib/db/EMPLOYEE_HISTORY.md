# Employee history update

Run `pnpm --filter @workspace/db run migrate:employee-history` with the intended
database configured through `DATABASE_URL`. The root Vercel API build runs it
after the card top-up schema update. It is additive, transactional and rerunnable;
it never deletes application data or invents a Drizzle migration baseline.

Employee deletion now archives the employee instead of deleting service visits.
This preserves employee IDs, recorded technician names, wages and consumed card
hours. Current rosters exclude archived employees; dated rosters include the
people who existed or have recorded visits in that month.

New employee-name/rate changes are versioned. The initial baseline records what
is known at migration time, not an invented past name. Earlier months use actual
recorded visit names when available, otherwise explicitly flag the name as
unverified. Previously deleted visits and unrecorded historical identities
cannot be reconstructed without a backup.
