import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { withBusinessRegistryClient } from "@workspace/db";
import { resolveSubscriptionAccess, type SubscriptionAccessRow } from "./subscription-access";

const TRIAL_DAYS = 30;
const QR_MAX_BYTES = 1024 * 1024;
const PRICES = {
  businessMonthly: 100_000,
  businessYearly: 1_000_000,
  personalMonthly: 20_000,
  personalYearly: 200_000,
} as const;

type Product = "business" | "personal";
type RegistryClient = Parameters<Parameters<typeof withBusinessRegistryClient>[0]>[0];
type BillingSettingsRow = {
  business_billing_enabled: boolean;
  personal_billing_enabled: boolean;
  qr_available: boolean;
};
type AccessRow = SubscriptionAccessRow & {
  trial_started_at: Date | string | null;
  trial_ends_at: Date | string | null;
  paid_until: Date | string | null;
  manual_access: boolean | null;
};
type PersonalAccessDbRow = AccessRow & { user_id: string };

export class SubscriptionBillingError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "SubscriptionBillingError";
  }
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeAccess(row: AccessRow | null, billingEnabled: boolean) {
  const result = resolveSubscriptionAccess(row, billingEnabled);
  return {
    ...result,
    trialStartedAt: asIso(result.trialStartedAt),
    trialEndsAt: asIso(result.trialEndsAt),
    paidUntil: asIso(result.paidUntil),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "23505";
}

async function getSettings(client: RegistryClient) {
  const result = await client.query<BillingSettingsRow>(`
    SELECT business_billing_enabled, personal_billing_enabled,
      (qr_image IS NOT NULL) AS qr_available
    FROM public.platform_billing_settings
    WHERE id = 1
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Platform billing settings have not been initialized on DB3.");
  return row;
}

async function ensurePersonalTrial(
  client: RegistryClient,
  userId: string,
) {
  await client.query(
    `INSERT INTO public.personal_subscriptions (user_id, trial_started_at, trial_ends_at)
     VALUES ($1, now(), now() + interval '30 days')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

async function ensureBusinessTrial(
  client: RegistryClient,
  businessId: string,
  billingEnabled: boolean,
) {
  await client.query(
    `INSERT INTO public.business_subscriptions (business_id, trial_started_at, trial_ends_at)
     SELECT id,
       CASE WHEN $2::boolean THEN now() ELSE NULL END,
       CASE WHEN $2::boolean THEN now() + interval '30 days' ELSE NULL END
     FROM public.businesses
     WHERE id = $1
     ON CONFLICT (business_id) DO UPDATE
       SET trial_started_at = CASE
             WHEN EXCLUDED.trial_started_at IS NOT NULL
               AND public.business_subscriptions.trial_started_at IS NULL
               AND public.business_subscriptions.paid_until IS NULL
               AND public.business_subscriptions.manual_access IS NULL
             THEN EXCLUDED.trial_started_at
             ELSE public.business_subscriptions.trial_started_at
           END,
           trial_ends_at = CASE
             WHEN EXCLUDED.trial_ends_at IS NOT NULL
               AND public.business_subscriptions.trial_started_at IS NULL
               AND public.business_subscriptions.paid_until IS NULL
               AND public.business_subscriptions.manual_access IS NULL
             THEN EXCLUDED.trial_ends_at
             ELSE public.business_subscriptions.trial_ends_at
           END`,
    [businessId, billingEnabled],
  );
}

async function getPersonalRow(client: RegistryClient, userId: string) {
  const result = await client.query<AccessRow>(
    `SELECT trial_started_at, trial_ends_at, paid_until, manual_access
     FROM public.personal_subscriptions WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function getBusinessRow(client: RegistryClient, businessId: string) {
  const result = await client.query<AccessRow>(
    `SELECT trial_started_at, trial_ends_at, paid_until, manual_access
     FROM public.business_subscriptions WHERE business_id = $1`,
    [businessId],
  );
  return result.rows[0] ?? null;
}

async function writeAudit(
  client: RegistryClient,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO public.billing_audit_events
      (id, actor_user_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [randomUUID(), actorUserId, action, targetType, targetId, JSON.stringify(details)],
  );
}

export function platformBillingSettingsResponse(row: BillingSettingsRow) {
  return {
    businessBillingEnabled: row.business_billing_enabled,
    personalBillingEnabled: row.personal_billing_enabled,
    trialDays: TRIAL_DAYS,
    qrAvailable: row.qr_available,
    prices: PRICES,
  };
}

export async function getPlatformBillingSettings() {
  return withBusinessRegistryClient(async (client) =>
    platformBillingSettingsResponse(await getSettings(client)),
  );
}

export async function updatePlatformBillingSettings(
  actorUserId: string,
  input: { businessBillingEnabled?: boolean; personalBillingEnabled?: boolean },
) {
  return withBusinessRegistryClient(async (client) => {
    await client.query("BEGIN");
    try {
      const before = await getSettings(client);
      const enablingFees =
        (input.businessBillingEnabled === true && !before.business_billing_enabled) ||
        (input.personalBillingEnabled === true && !before.personal_billing_enabled);
      if (enablingFees && !before.qr_available) {
        throw new SubscriptionBillingError("Hãy tải mã QR thanh toán trước khi bật thu phí.", 409);
      }
      const result = await client.query<BillingSettingsRow>(`
        UPDATE public.platform_billing_settings
        SET business_billing_enabled = COALESCE($1, business_billing_enabled),
            personal_billing_enabled = COALESCE($2, personal_billing_enabled),
            updated_by = $3,
            updated_at = now()
        WHERE id = 1
        RETURNING business_billing_enabled, personal_billing_enabled,
          (qr_image IS NOT NULL) AS qr_available
      `, [
        input.businessBillingEnabled ?? null,
        input.personalBillingEnabled ?? null,
        actorUserId,
      ]);
      const after = result.rows[0];
      if (!after) throw new Error("Platform billing settings could not be updated.");
      if (input.businessBillingEnabled === true && !before.business_billing_enabled) {
        await client.query(`
          UPDATE public.business_subscriptions
          SET trial_started_at = now(),
              trial_ends_at = now() + interval '30 days',
              updated_at = now()
          WHERE trial_started_at IS NULL
            AND paid_until IS NULL
            AND manual_access IS NULL
        `);
      }
      await writeAudit(client, actorUserId, "billing.settings.update", "platform", "global", {
        before: {
          businessBillingEnabled: before.business_billing_enabled,
          personalBillingEnabled: before.personal_billing_enabled,
        },
        after: {
          businessBillingEnabled: after.business_billing_enabled,
          personalBillingEnabled: after.personal_billing_enabled,
        },
      });
      await client.query("COMMIT");
      return platformBillingSettingsResponse(after);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

export async function savePlatformPaymentQr(
  actorUserId: string,
  image: Buffer,
  contentType: string,
) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
    throw new SubscriptionBillingError("Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP.", 400);
  }
  if (!image.length || image.length > QR_MAX_BYTES) {
    throw new SubscriptionBillingError("Ảnh QR phải có dung lượng từ 1 byte đến 1 MB.", 400);
  }
  await withBusinessRegistryClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE public.platform_billing_settings
         SET qr_image = $1, qr_content_type = $2, qr_updated_by = $3, updated_at = now()
         WHERE id = 1`,
        [image, contentType, actorUserId],
      );
      await writeAudit(client, actorUserId, "billing.qr.replace", "platform", "global", {
        contentType,
        size: image.length,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

export async function getPlatformPaymentQr() {
  return withBusinessRegistryClient(async (client) => {
    const result = await client.query<{ qr_image: Buffer | null; qr_content_type: string | null }>(`
      SELECT qr_image, qr_content_type
      FROM public.platform_billing_settings WHERE id = 1
    `);
    const row = result.rows[0];
    if (!row?.qr_image || !row.qr_content_type) {
      throw new SubscriptionBillingError("Chưa có mã QR thanh toán.", 404);
    }
    return { image: row.qr_image, contentType: row.qr_content_type };
  });
}

export async function getSubscriptionStatus(input: {
  userId: string;
  hasVerifiedEmail: boolean;
  businessId: string | null;
  isPlatformAdmin: boolean;
}) {
  return withBusinessRegistryClient(async (client) => {
    const settings = await getSettings(client);
    if (input.hasVerifiedEmail && settings.personal_billing_enabled) {
      await ensurePersonalTrial(client, input.userId);
    }
    const personalRow = await getPersonalRow(client, input.userId);
    let personal = normalizeAccess(personalRow, settings.personal_billing_enabled);
    if (!input.hasVerifiedEmail && settings.personal_billing_enabled &&
        personalRow?.manual_access !== false && personalRow?.manual_access !== true) {
      personal = { ...personal, status: "verification_required", accessAllowed: false };
    }
    let business = null;
    if (input.businessId) {
      await ensureBusinessTrial(client, input.businessId, settings.business_billing_enabled);
      business = normalizeAccess(await getBusinessRow(client, input.businessId), settings.business_billing_enabled);
    }
    if (input.isPlatformAdmin) {
      personal = { ...personal, status: "free", accessAllowed: true };
      if (business) business = { ...business, status: "free", accessAllowed: true };
    }
    return {
      personal,
      business,
      paymentQrAvailable: settings.qr_available,
      prices: PRICES,
    };
  });
}

export async function getPersonalSubscriptionAccess(userId: string, hasVerifiedEmail: boolean) {
  return withBusinessRegistryClient(async (client) => {
    const settings = await getSettings(client);
    if (hasVerifiedEmail && settings.personal_billing_enabled) {
      await ensurePersonalTrial(client, userId);
    }
    const row = await getPersonalRow(client, userId);
    const access = normalizeAccess(row, settings.personal_billing_enabled);
    if (!hasVerifiedEmail && settings.personal_billing_enabled &&
        row?.manual_access !== false && row?.manual_access !== true) {
      return { ...access, status: "verification_required" as const, accessAllowed: false };
    }
    return access;
  });
}

export async function getBusinessSubscriptionAccess(businessId: string) {
  return withBusinessRegistryClient(async (client) => {
    const settings = await getSettings(client);
    await ensureBusinessTrial(client, businessId, settings.business_billing_enabled);
    return normalizeAccess(await getBusinessRow(client, businessId), settings.business_billing_enabled);
  });
}

function paymentRequestOutput(row: {
  id: string;
  user_id: string;
  product: Product;
  months: number;
  amount_vnd: number;
  status: "pending" | "approved" | "rejected";
  created_at: Date | string;
  business_id: string | null;
  business_name: string | null;
}) {
  return {
    id: row.id,
    userId: row.user_id,
    product: row.product,
    months: row.months,
    amountVnd: row.amount_vnd,
    status: row.status,
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
    businessId: row.business_id,
    businessName: row.business_name,
  };
}

const paymentRequestSelect = `
  SELECT r.id, r.user_id, r.product, r.months, r.amount_vnd, r.status, r.created_at,
    r.business_id, b.name AS business_name
  FROM public.subscription_payment_requests r
  LEFT JOIN public.businesses b ON b.id = r.business_id
`;

export async function listMySubscriptionPaymentRequests(userId: string) {
  return withBusinessRegistryClient(async (client) => {
    const result = await client.query(paymentRequestSelect + `
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
      LIMIT 100
    `, [userId]);
    return result.rows.map(paymentRequestOutput);
  });
}

export async function listPlatformPaymentRequests(
  status?: "pending" | "approved" | "rejected",
) {
  return withBusinessRegistryClient(async (client) => {
    const result = await client.query(
      paymentRequestSelect +
      (status ? " WHERE r.status = $1" : "") +
      " ORDER BY r.created_at DESC LIMIT 200",
      status ? [status] : [],
    );
    return result.rows.map(paymentRequestOutput);
  });
}

export async function createSubscriptionPaymentRequest(input: {
  userId: string;
  product: Product;
  months: 1 | 12;
  businessId?: string;
  idempotencyKey: string;
}) {
  return withBusinessRegistryClient(async (client) => {
    await client.query("BEGIN");
    try {
      const settings = await getSettings(client);
      if (!settings.qr_available) {
        throw new SubscriptionBillingError("Quản trị viên chưa cài mã QR thanh toán.", 409);
      }
      if (input.product === "personal" && !settings.personal_billing_enabled) {
        throw new SubscriptionBillingError("Gói cá nhân hiện chưa thu phí.", 409);
      }
      if (input.product === "business" && !settings.business_billing_enabled) {
        throw new SubscriptionBillingError("Gói doanh nghiệp hiện chưa thu phí.", 409);
      }

      let businessName: string | null = null;
      let manuallyBlocked = false;
      if (input.product === "business") {
        if (!input.businessId) {
          throw new SubscriptionBillingError("Hãy chọn cơ sở cần gia hạn.", 400);
        }
        const owner = await client.query<{ name: string }>(
          `SELECT name FROM public.businesses
           WHERE id = $1 AND owner_user_id = $2 AND active = true
           LIMIT 1`,
          [input.businessId, input.userId],
        );
        if (!owner.rows[0]) {
          throw new SubscriptionBillingError("Chỉ chủ sở hữu của cơ sở mới được yêu cầu gia hạn.", 403);
        }
        businessName = owner.rows[0].name;
        const access = await client.query<{ manual_access: boolean | null }>(
          `SELECT manual_access FROM public.business_subscriptions WHERE business_id = $1`,
          [input.businessId],
        );
        manuallyBlocked = access.rows[0]?.manual_access === false;
      } else if (input.businessId) {
        throw new SubscriptionBillingError("Gói cá nhân không nhận mã cơ sở.", 400);
      } else {
        const access = await client.query<{ manual_access: boolean | null }>(
          `SELECT manual_access FROM public.personal_subscriptions WHERE user_id = $1`,
          [input.userId],
        );
        manuallyBlocked = access.rows[0]?.manual_access === false;
      }
      if (manuallyBlocked) {
        throw new SubscriptionBillingError(
          "Quản trị viên đã khóa quyền truy cập; thanh toán không thể tự gỡ khóa này.",
          403,
        );
      }

      const amountVnd = input.product === "business"
        ? input.months === 1 ? PRICES.businessMonthly : PRICES.businessYearly
        : input.months === 1 ? PRICES.personalMonthly : PRICES.personalYearly;
      const id = randomUUID();
      const inserted = await client.query<{
        id: string; user_id: string; product: Product; months: number; amount_vnd: number;
        status: "pending" | "approved" | "rejected"; created_at: Date | string;
        business_id: string | null;
      }>(`
        INSERT INTO public.subscription_payment_requests
          (id, user_id, product, business_id, months, amount_vnd, idempotency_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, idempotency_key) DO NOTHING
        RETURNING id, user_id, product, months, amount_vnd, status, created_at, business_id
      `, [id, input.userId, input.product, input.businessId ?? null, input.months, amountVnd, input.idempotencyKey]);
      let row = inserted.rows[0];
      if (!row) {
        const prior = await client.query<{
          id: string; user_id: string; product: Product; months: number; amount_vnd: number;
          status: "pending" | "approved" | "rejected"; created_at: Date | string;
          business_id: string | null;
        }>(`
          SELECT id, user_id, product, months, amount_vnd, status, created_at, business_id
          FROM public.subscription_payment_requests
          WHERE user_id = $1 AND idempotency_key = $2
          LIMIT 1
        `, [input.userId, input.idempotencyKey]);
        row = prior.rows[0];
        if (!row || row.product !== input.product || row.business_id !== (input.businessId ?? null) ||
            row.months !== input.months) {
          throw new SubscriptionBillingError("Mã yêu cầu đã được dùng cho nội dung khác.", 409);
        }
      } else {
        await writeAudit(client, input.userId, "billing.payment-request.create", "payment-request", row.id, {
          product: input.product,
          months: input.months,
          amountVnd,
          businessId: input.businessId ?? null,
        });
      }
      await client.query("COMMIT");
      return paymentRequestOutput({
        ...row,
        business_name: businessName,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isUniqueViolation(error)) {
        throw new SubscriptionBillingError("Đã có một yêu cầu thanh toán đang chờ cho mục này.", 409);
      }
      throw error;
    }
  });
}

async function extendSubscription(
  client: RegistryClient,
  product: Product,
  months: 1 | 6 | 12,
  userId?: string,
  businessId?: string,
) {
  if (product === "personal") {
    if (!userId || businessId) throw new SubscriptionBillingError("Thông tin gói cá nhân không hợp lệ.", 400);
    await client.query(
      `INSERT INTO public.personal_subscriptions (user_id)
       VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
    await client.query(
      `UPDATE public.personal_subscriptions
       SET paid_until = GREATEST(COALESCE(paid_until, now()), now()) + ($2::int * interval '1 month'),
           manual_access = NULL,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, months],
    );
    return { targetType: "personal-account", targetId: userId };
  }
  if (!businessId || userId) throw new SubscriptionBillingError("Thông tin gói doanh nghiệp không hợp lệ.", 400);
   await ensureBusinessTrial(client, businessId, false);
  const exists = await client.query(`SELECT 1 FROM public.businesses WHERE id = $1`, [businessId]);
  if (!exists.rowCount) throw new SubscriptionBillingError("Không tìm thấy doanh nghiệp.", 404);
  await client.query(
    `UPDATE public.business_subscriptions
     SET paid_until = GREATEST(COALESCE(paid_until, now()), now()) + ($2::int * interval '1 month'),
         manual_access = NULL,
         updated_at = now()
     WHERE business_id = $1`,
    [businessId, months],
  );
  return { targetType: "business", targetId: businessId };
}

export async function renewPlatformSubscription(
  actorUserId: string,
  input: { product: Product; months: 1 | 6 | 12; userId?: string; businessId?: string },
) {
  return withBusinessRegistryClient(async (client) => {
    await client.query("BEGIN");
    try {
      const target = await extendSubscription(client, input.product, input.months, input.userId, input.businessId);
      await writeAudit(client, actorUserId, "billing.subscription.renew", target.targetType, target.targetId, {
        months: input.months,
        product: input.product,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

export async function reviewSubscriptionPaymentRequest(
  actorUserId: string,
  requestId: string,
  decision: "approved" | "rejected",
) {
  return withBusinessRegistryClient(async (client) => {
    await client.query("BEGIN");
    try {
      const request = await client.query<{
        id: string; user_id: string; product: Product; months: 1 | 12;
        status: "pending" | "approved" | "rejected"; business_id: string | null;
      }>(`
        SELECT id, user_id, product, months, status, business_id
        FROM public.subscription_payment_requests
        WHERE id = $1
        FOR UPDATE
      `, [requestId]);
      const row = request.rows[0];
      if (!row) throw new SubscriptionBillingError("Không tìm thấy yêu cầu thanh toán.", 404);
      if (row.status !== "pending") throw new SubscriptionBillingError("Yêu cầu này đã được xử lý.", 409);
      if (decision === "approved") {
        let access: { rows: Array<{ manual_access: boolean | null }> };
        if (row.product === "personal") {
          await client.query(
            `INSERT INTO public.personal_subscriptions (user_id)
             VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
            [row.user_id],
          );
          access = await client.query<{ manual_access: boolean | null }>(
            `SELECT manual_access FROM public.personal_subscriptions WHERE user_id = $1 FOR UPDATE`,
            [row.user_id],
          );
        } else if (row.business_id) {
          await ensureBusinessTrial(client, row.business_id, false);
          access = await client.query<{ manual_access: boolean | null }>(
            `SELECT manual_access FROM public.business_subscriptions WHERE business_id = $1 FOR UPDATE`,
            [row.business_id],
          );
        } else {
          throw new SubscriptionBillingError("Yêu cầu doanh nghiệp thiếu mã cơ sở.", 409);
        }
        if (access?.rows[0]?.manual_access === false) {
          throw new SubscriptionBillingError(
            "Tài khoản đang bị khóa thủ công. Hãy mở quyền trước khi xác nhận thanh toán.",
            409,
          );
        }
        const target = await extendSubscription(
          client,
          row.product,
          row.months,
          row.product === "personal" ? row.user_id : undefined,
          row.product === "business" ? row.business_id ?? undefined : undefined,
        );
        await writeAudit(client, actorUserId, "billing.payment-request.approve", target.targetType, target.targetId, {
          requestId,
          months: row.months,
        });
      } else {
        await writeAudit(client, actorUserId, "billing.payment-request.reject", "payment-request", requestId, {});
      }
      await client.query(
        `UPDATE public.subscription_payment_requests
         SET status = $2, reviewed_at = now(), reviewed_by = $3
         WHERE id = $1`,
        [requestId, decision, actorUserId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

export async function updatePlatformPersonalAccess(actorUserId: string, userId: string, allowed: boolean) {
  await withBusinessRegistryClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO public.personal_subscriptions (user_id, manual_access)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET manual_access = EXCLUDED.manual_access, updated_at = now()`,
        [userId, allowed],
      );
      await writeAudit(client, actorUserId, "billing.personal-access.update", "personal-account", userId, { allowed });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

export async function updatePlatformBusinessAccess(actorUserId: string, businessId: string, allowed: boolean) {
  await withBusinessRegistryClient(async (client) => {
    await client.query("BEGIN");
    try {
      const settings = await getSettings(client);
      await ensureBusinessTrial(client, businessId, settings.business_billing_enabled);
      const exists = await client.query(`SELECT 1 FROM public.businesses WHERE id = $1`, [businessId]);
      if (!exists.rowCount) throw new SubscriptionBillingError("Không tìm thấy cơ sở.", 404);
      await client.query(
        `UPDATE public.business_subscriptions
         SET manual_access = $2, updated_at = now()
         WHERE business_id = $1`,
        [businessId, allowed],
      );
      await writeAudit(client, actorUserId, "billing.business-access.update", "business", businessId, { allowed });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

type AdminAccount = {
  userId: string;
  email: string | null;
  name: string;
  createdAt: string;
  personal: ReturnType<typeof normalizeAccess>;
  businesses: Array<{
    id: string;
    name: string;
    role: "owner" | "employee";
    access: ReturnType<typeof normalizeAccess>;
  }>;
};

export async function listPlatformBillingAccounts(input: {
  query?: string;
  limit: number;
  offset: number;
}) {
  const secretKey = process.env.APP_CLERK_SECRET_KEY?.trim();
  const publishableKey = process.env.APP_CLERK_PUBLISHABLE_KEY?.trim();
  if (!secretKey || !publishableKey) throw new Error("Clerk server credentials are not configured.");
  const clerk = createClerkClient({ secretKey, publishableKey });
  const page = await clerk.users.getUserList({
    limit: input.limit,
    offset: input.offset,
    ...(input.query ? { query: input.query } : {}),
  });
  const userIds = page.data.map((user) => user.id);
  const directory = await withBusinessRegistryClient(async (client) => {
    const settings = await getSettings(client);
    if (!userIds.length) return { personal: new Map<string, AccessRow>(), businesses: [] as Array<{
      user_id: string; id: string; name: string; role: "owner" | "employee";
      trial_started_at: Date | string | null; trial_ends_at: Date | string | null;
      paid_until: Date | string | null; manual_access: boolean | null;
    }>, settings };
    const [personalRows, businessRows] = await Promise.all([
      client.query<PersonalAccessDbRow>(
        `SELECT user_id, trial_started_at, trial_ends_at, paid_until, manual_access
         FROM public.personal_subscriptions WHERE user_id = ANY($1::text[])`,
        [userIds],
      ),
      client.query<{
        user_id: string; id: string; name: string; role: "owner" | "employee";
        trial_started_at: Date | string | null; trial_ends_at: Date | string | null;
        paid_until: Date | string | null; manual_access: boolean | null;
      }>(`
        SELECT m.user_id, b.id, b.name, m.role,
          s.trial_started_at, s.trial_ends_at, s.paid_until, s.manual_access
        FROM public.business_memberships m
        JOIN public.businesses b ON b.id = m.business_id
        LEFT JOIN public.business_subscriptions s ON s.business_id = b.id
        WHERE m.user_id = ANY($1::text[]) AND m.active = true
        ORDER BY b.name, m.role
      `, [userIds]),
    ]);
    return {
      personal: new Map(personalRows.rows.map((row) => [row.user_id, row])),
      businesses: businessRows.rows,
      settings,
    };
  });
  const byUser = new Map<string, AdminAccount>();
  for (const user of page.data) {
    const email = user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || null;
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || email || "Tài khoản";
    const personalRow = directory.personal.get(user.id) ?? null;
    byUser.set(user.id, {
      userId: user.id,
      email,
      name,
      createdAt: new Date(user.createdAt).toISOString(),
      personal: normalizeAccess(personalRow, directory.settings.personal_billing_enabled),
      businesses: [],
    });
  }
  for (const business of directory.businesses) {
    const account = byUser.get(business.user_id);
    if (!account) continue;
    account.businesses.push({
      id: business.id,
      name: business.name,
      role: business.role,
      access: normalizeAccess(business, directory.settings.business_billing_enabled),
    });
  }
  return {
    items: [...byUser.values()],
    totalCount: page.totalCount,
    limit: input.limit,
    offset: input.offset,
  };
}
