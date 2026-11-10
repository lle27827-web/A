import { createHash, randomInt } from "node:crypto";
import pg from "pg";
import {
  resolveDirectConfiguredStores,
} from "./vercel-stores.mjs";

const defaultBusinessId = "00000000-0000-4000-8000-000000000001";
const ownerEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (!ownerEmail) {
  throw new Error("Business tenancy migration requires ADMIN_EMAIL to preserve the current facility owner.");
}

const stores = resolveDirectConfiguredStores(process.env);

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
    facility_name text NOT NULL DEFAULT '',
    facility_address text NOT NULL DEFAULT '',
    facility_tax_code text NOT NULL DEFAULT '',
    facility_phone text NOT NULL DEFAULT '',
    print_profile_updated_at timestamptz NOT NULL DEFAULT now(),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE public.businesses
    ADD COLUMN IF NOT EXISTS facility_name text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS facility_address text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS facility_tax_code text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS facility_phone text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS print_profile_updated_at timestamptz NOT NULL DEFAULT now();
  CREATE UNIQUE INDEX IF NOT EXISTS businesses_join_code_hash_unique
    ON public.businesses(join_code_hash);
  CREATE INDEX IF NOT EXISTS businesses_owner_user_idx
    ON public.businesses(owner_user_id);
  CREATE TABLE IF NOT EXISTS public.business_users (
    user_id text PRIMARY KEY,
    email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS business_users_email_idx
    ON public.business_users(email);
  CREATE TABLE IF NOT EXISTS public.business_memberships (
    id uuid PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    user_id text NOT NULL REFERENCES public.business_users(user_id) ON DELETE RESTRICT,
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
  CREATE TABLE IF NOT EXISTS public.business_join_attempts (
    id uuid PRIMARY KEY,
    key_hash text NOT NULL,
    attempted_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS business_join_attempts_key_time_idx
    ON public.business_join_attempts(key_hash, attempted_at);
  CREATE INDEX IF NOT EXISTS business_join_attempts_time_idx
    ON public.business_join_attempts(attempted_at);
  INSERT INTO public.business_users (user_id, email)
    SELECT owner_user_id, lower(min(btrim(owner_email)))
    FROM public.businesses
    WHERE owner_user_id <> '' AND owner_user_id NOT LIKE 'pending-owner:%'
    GROUP BY owner_user_id
    ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email, updated_at = now();
  INSERT INTO public.business_users (user_id, email)
    SELECT user_id, lower(min(btrim(email)))
    FROM public.business_memberships
    WHERE user_id <> '' AND btrim(email) <> ''
    GROUP BY user_id
    ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email, updated_at = now();
  DO $migration$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.business_memberships m
      LEFT JOIN public.businesses b ON b.id = m.business_id
      WHERE b.id IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot enable tenant foreign keys: business memberships reference missing businesses.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.business_memberships m
      LEFT JOIN public.business_users u ON u.user_id = m.user_id
      WHERE u.user_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot enable tenant foreign keys: business memberships reference missing users.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.business_memberships'::regclass
        AND conname = 'business_memberships_business_id_fkey'
    ) THEN
      ALTER TABLE public.business_memberships
        ADD CONSTRAINT business_memberships_business_id_fkey
        FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.business_memberships'::regclass
        AND conname = 'business_memberships_user_id_fkey'
    ) THEN
      ALTER TABLE public.business_memberships
        ADD CONSTRAINT business_memberships_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.business_users(user_id) ON DELETE RESTRICT;
    END IF;
  END
  $migration$;
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
