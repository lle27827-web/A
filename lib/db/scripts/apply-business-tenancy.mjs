import { createHash, randomInt } from "node:crypto";
import pg from "pg";

const defaultBusinessId = "00000000-0000-4000-8000-000000000001";
const ownerEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (!ownerEmail) {
  throw new Error("Business tenancy migration requires ADMIN_EMAIL to preserve the current facility owner.");
}

const stores = [
  { backend: "database_url_1", url: process.env.NEON_DB1_DIRECT_URL?.trim() || process.env.DATABASE_URL_1?.trim() },
  { backend: "database_url", url: process.env.NEON_SOURCE_DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim() },
  { backend: "database_url_3", url: process.env.MIGRATE_DATABASE_URL_3_DIRECT?.trim() || process.env.DATABASE_URL_3?.trim() },
  { backend: "database_url_4", url: process.env.MIGRATE_DATABASE_URL_4_DIRECT?.trim() || process.env.DATABASE_URL_4?.trim() },
];
if (stores.some((store) => !store.url)) {
  throw new Error("Business tenancy migration requires all four configured database stores.");
}

const hosts = stores.map(({ url }) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/-pooler(?:\.|$)/i.test(host)) throw new Error("pooled endpoint");
    return host;
  } catch {
    throw new Error("Use valid direct Neon endpoints for the four tenancy migrations.");
  }
});
if (new Set(hosts).size !== hosts.length) {
  throw new Error("Business tenancy migration requires four distinct Neon databases.");
}

const tables = [
  "members",
  "member_versions",
  "attendance",
  "treatment_cards",
  "card_top_ups",
  "card_usage_history",
  "service_sessions",
  "service_types",
  "manager_grants",
  "appointments",
  "employee_availability",
  "facility_bonus_settings",
  "employee_service_bonus_rates",
  "facility_night_settings",
];
const eventTypes = new Set(tables);

const registrySql = `
  CREATE TABLE IF NOT EXISTS public.businesses (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    owner_user_id text NOT NULL,
    owner_email text NOT NULL,
    join_code_hash text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS businesses_join_code_hash_unique
    ON public.businesses(join_code_hash);
  CREATE INDEX IF NOT EXISTS businesses_owner_user_idx
    ON public.businesses(owner_user_id);
  CREATE TABLE IF NOT EXISTS public.business_memberships (
    id uuid PRIMARY KEY,
    business_id uuid NOT NULL,
    user_id text NOT NULL,
    email text NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'employee')),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS business_memberships_business_user_unique
    ON public.business_memberships(business_id, user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS business_memberships_business_email_unique
    ON public.business_memberships(business_id, email);
  CREATE INDEX IF NOT EXISTS business_memberships_user_active_idx
    ON public.business_memberships(user_id, active);
`;

function tenancySql() {
  const statements = [];
  for (const table of tables) {
    statements.push(
      `ALTER TABLE public."${table}" ADD COLUMN IF NOT EXISTS business_id text NOT NULL DEFAULT '${defaultBusinessId}';`,
      `CREATE INDEX IF NOT EXISTS "${table}_business_id_idx" ON public."${table}"(business_id);`,
    );
  }
  statements.push(
    `DROP INDEX IF EXISTS public.manager_grants_email_unique;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS manager_grants_business_email_unique ON public.manager_grants(business_id, email);`,
    `DROP INDEX IF EXISTS public.employee_service_bonus_rates_member_service_uidx;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS employee_service_bonus_rates_member_service_uidx ON public.employee_service_bonus_rates(business_id, member_id, service_type_id);`,
    `DO $migration$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.facility_bonus_settings'::regclass AND conname='facility_bonus_settings_pkey') THEN
          ALTER TABLE public.facility_bonus_settings DROP CONSTRAINT facility_bonus_settings_pkey;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.facility_bonus_settings'::regclass AND conname='facility_bonus_settings_pkey') THEN
          ALTER TABLE public.facility_bonus_settings ADD CONSTRAINT facility_bonus_settings_pkey PRIMARY KEY (business_id, id);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.facility_night_settings'::regclass AND conname='facility_night_settings_pkey') THEN
          ALTER TABLE public.facility_night_settings DROP CONSTRAINT facility_night_settings_pkey;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.facility_night_settings'::regclass AND conname='facility_night_settings_pkey') THEN
          ALTER TABLE public.facility_night_settings ADD CONSTRAINT facility_night_settings_pkey PRIMARY KEY (business_id, id);
        END IF;
      END
    $migration$;`,
    `UPDATE public.storage_partition_events
      SET payload = jsonb_set(payload, '{businessId}', to_jsonb('${defaultBusinessId}'::text), true)
      WHERE committed = true AND action = 'upsert' AND entity_type = ANY(ARRAY[${[...eventTypes].map((table) => `'${table}'`).join(",")}])
        AND jsonb_typeof(payload) = 'object' AND NOT (payload ? 'businessId');`,
  );
  return statements.join("\n");
}

const joinCode = String(randomInt(1000000000, 9999999999));
const joinCodeHash = createHash("sha256").update(joinCode).digest("hex");

for (const [index, store] of stores.entries()) {
  const pool = new pg.Pool({
    connectionString: store.url,
    application_name: `so-cong-business-tenancy-migration-${index + 1}`,
    connectionTimeoutMillis: 15_000,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:business-tenancy-v1', 0))");
    if (store.backend === "database_url_4") {
      await client.query(registrySql);
    }
    await client.query(tenancySql());
    if (store.backend === "database_url_4") {
      await client.query(
        `INSERT INTO public.businesses
          (id, name, owner_user_id, owner_email, join_code_hash, active)
         VALUES ($1::uuid, 'Cơ sở hiện tại', $2, $3, $4, true)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, owner_email = EXCLUDED.owner_email, active = true`,
        [defaultBusinessId, `pending-owner:${ownerEmail}`, ownerEmail, joinCodeHash],
      );
      await client.query(
        `UPDATE public.businesses SET join_code_hash = $2 WHERE id = $1::uuid AND join_code_hash IS NULL`,
        [defaultBusinessId, joinCodeHash],
      );
    }
    await client.query("COMMIT");
    process.stdout.write(`Business tenancy schema preserved and prepared on ${store.backend}.\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
