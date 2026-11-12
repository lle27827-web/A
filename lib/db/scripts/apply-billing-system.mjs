import pg from "pg";
import { resolveDirectConfiguredStores } from "./vercel-stores.mjs";

const db3 = resolveDirectConfiguredStores(process.env)
  .find((store) => store.backend === "database_url_3");

if (!db3) {
  throw new Error("Billing registry requires a direct DB3 connection.");
}

const pool = new pg.Pool({
  connectionString: db3.url,
  application_name: "so-cong-billing-schema",
  connectionTimeoutMillis: 15_000,
  max: 1,
});

const sql = `
  CREATE TABLE IF NOT EXISTS public.platform_billing_settings (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    business_billing_enabled boolean NOT NULL DEFAULT false,
    personal_billing_enabled boolean NOT NULL DEFAULT false,
    qr_image bytea,
    qr_content_type text,
    qr_updated_by text,
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
      (qr_image IS NULL AND qr_content_type IS NULL) OR
      (qr_image IS NOT NULL AND qr_content_type IS NOT NULL AND
       qr_content_type IN ('image/png', 'image/jpeg', 'image/webp'))
    )
  );
  INSERT INTO public.platform_billing_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS public.personal_subscriptions (
    user_id text PRIMARY KEY,
    trial_started_at timestamptz,
    trial_ends_at timestamptz,
    paid_until timestamptz,
    manual_access boolean,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
      (trial_started_at IS NULL AND trial_ends_at IS NULL) OR
      (trial_started_at IS NOT NULL AND trial_ends_at IS NOT NULL AND
       trial_ends_at >= trial_started_at)
    )
  );

  CREATE TABLE IF NOT EXISTS public.business_subscriptions (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE RESTRICT,
    trial_started_at timestamptz,
    trial_ends_at timestamptz,
    paid_until timestamptz,
    manual_access boolean,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
      (trial_started_at IS NULL AND trial_ends_at IS NULL) OR
      (trial_started_at IS NOT NULL AND trial_ends_at IS NOT NULL AND
       trial_ends_at >= trial_started_at)
    )
  );
  INSERT INTO public.business_subscriptions (business_id, trial_started_at, trial_ends_at)
    SELECT id, NULL, NULL
    FROM public.businesses
    ON CONFLICT (business_id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS public.subscription_payment_requests (
    id uuid PRIMARY KEY,
    user_id text NOT NULL,
    product text NOT NULL CHECK (product IN ('business', 'personal')),
    business_id uuid REFERENCES public.businesses(id) ON DELETE RESTRICT,
    months integer NOT NULL CHECK (months IN (1, 12)),
    amount_vnd integer NOT NULL CHECK (amount_vnd > 0),
    status text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected')),
    idempotency_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    reviewed_by text,
    CHECK ((product = 'business' AND business_id IS NOT NULL) OR
           (product = 'personal' AND business_id IS NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_requests_user_key_unique
    ON public.subscription_payment_requests (user_id, idempotency_key);
  CREATE INDEX IF NOT EXISTS subscription_payment_requests_status_created_idx
    ON public.subscription_payment_requests (status, created_at DESC);
  CREATE INDEX IF NOT EXISTS subscription_payment_requests_user_created_idx
    ON public.subscription_payment_requests (user_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS subscription_pending_personal_unique
    ON public.subscription_payment_requests (user_id)
    WHERE status = 'pending' AND product = 'personal';
  CREATE UNIQUE INDEX IF NOT EXISTS subscription_pending_business_unique
    ON public.subscription_payment_requests (user_id, business_id)
    WHERE status = 'pending' AND product = 'business';

  CREATE TABLE IF NOT EXISTS public.billing_audit_events (
    id uuid PRIMARY KEY,
    actor_user_id text NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS billing_audit_events_target_created_idx
    ON public.billing_audit_events (target_type, target_id, created_at DESC);
`;

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('so-cong:billing-registry-v1', 0))",
  );
  await client.query(sql);
  await client.query("COMMIT");
  console.log("DB3 billing registry schema ready; existing business data was preserved.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
