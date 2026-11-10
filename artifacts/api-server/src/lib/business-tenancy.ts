import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";
import { withBusinessRegistryClient } from "@workspace/db";

export const DEFAULT_BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

export type BusinessRole = "owner" | "employee";
export type BusinessSummary = {
  id: string;
  name: string;
  role: BusinessRole | "platform_admin";
};
export type BusinessMemberSummary = {
  email: string;
  role: BusinessRole;
};
export type BusinessPrintProfile = {
  facilityName: string;
  facilityAddress: string;
  facilityTaxCode: string;
  facilityPhone: string;
};

export type JoinBusinessResult =
  | { kind: "joined"; business: BusinessSummary }
  | { kind: "invalid-code" }
  | { kind: "rate-limited"; retryAfterSeconds: number };

type BusinessRegistryClient = {
  query: (text: string, values?: unknown[]) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount?: number | null;
  }>;
};

const JOIN_FAILURE_LIMIT = 5;
const JOIN_FAILURE_WINDOW = "15 minutes";
export const MAX_ACTIVE_BUSINESSES_PER_OWNER = 10;

export class BusinessCreationLimitError extends Error {
  constructor() {
    super("Tài khoản đã đạt giới hạn 10 cơ sở đang hoạt động.");
  }
}

const hashJoinCode = (code: string) =>
  createHash("sha256").update(code, "utf8").digest("hex");

const normalizeEmail = (email: string | null | undefined) => email?.trim().toLowerCase() ?? "";

function printProfileFromRow(row: Record<string, unknown>): BusinessPrintProfile {
  return {
    facilityName: String(row.facility_name ?? ""),
    facilityAddress: String(row.facility_address ?? ""),
    facilityTaxCode: String(row.facility_tax_code ?? ""),
    facilityPhone: String(row.facility_phone ?? ""),
  };
}

export async function getBusinessPrintProfile(businessId: string): Promise<BusinessPrintProfile | null> {
  return withBusinessRegistryClient((client) =>
    getBusinessPrintProfileWithClient(client, businessId),
  );
}

export async function getBusinessPrintProfileWithClient(
  client: BusinessRegistryClient,
  businessId: string,
): Promise<BusinessPrintProfile | null> {
  const result = await client.query(
    `SELECT facility_name, facility_address, facility_tax_code, facility_phone
     FROM public.businesses
     WHERE id = $1::uuid AND active = true`,
    [businessId],
  );
  const row = result.rows[0];
  return row ? printProfileFromRow(row) : null;
}

export async function updateBusinessPrintProfile(input: {
  businessId: string;
  ownerUserId: string;
  profile: BusinessPrintProfile;
}): Promise<BusinessPrintProfile | null> {
  return withBusinessRegistryClient((client) =>
    updateBusinessPrintProfileWithClient(client, input),
  );
}

export async function updateBusinessPrintProfileWithClient(
  client: BusinessRegistryClient,
  input: { businessId: string; ownerUserId: string; profile: BusinessPrintProfile },
): Promise<BusinessPrintProfile | null> {
  const result = await client.query(
    `UPDATE public.businesses
     SET facility_name = $3,
         facility_address = $4,
         facility_tax_code = $5,
         facility_phone = $6,
         print_profile_updated_at = now()
     WHERE id = $1::uuid AND owner_user_id = $2 AND active = true
     RETURNING facility_name, facility_address, facility_tax_code, facility_phone`,
    [
      input.businessId,
      input.ownerUserId,
      input.profile.facilityName,
      input.profile.facilityAddress,
      input.profile.facilityTaxCode,
      input.profile.facilityPhone,
    ],
  );
  const row = result.rows[0];
  return row ? printProfileFromRow(row) : null;
}

export function isVerifiedAdminIdentity(
  identity: { email: string | null; verified: boolean },
  adminEmail: string | null | undefined,
): boolean {
  const configuredEmail = normalizeEmail(adminEmail);
  const verifiedEmail = identity.verified ? normalizeEmail(identity.email) : "";
  return Boolean(configuredEmail && verifiedEmail && verifiedEmail === configuredEmail);
}

function hashJoinAttemptKey(secret: string, kind: "user" | "ip", value: string): string {
  return createHmac("sha256", secret)
    .update(`so-cong:business-join-rate-limit:v1\0${kind}\0${value}`, "utf8")
    .digest("hex");
}

function getJoinAttemptKeys(
  input: { userId: string; ipAddress: string },
  secret: string,
): string[] {
  return [
    hashJoinAttemptKey(secret, "user", input.userId),
    hashJoinAttemptKey(secret, "ip", input.ipAddress),
  ].sort();
}

async function lockJoinAttemptKeys(client: BusinessRegistryClient, keys: string[]): Promise<void> {
  for (const key of keys) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [key],
    );
  }
}

export async function ensureBusinessCreationCapacity(
  client: BusinessRegistryClient,
  ownerUserId: string,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`so-cong:business-create:${ownerUserId}`],
  );
  const result = await client.query(
    `SELECT COUNT(*)::int AS active_count
     FROM public.businesses
     WHERE owner_user_id = $1 AND active = true`,
    [ownerUserId],
  );
  if (Number(result.rows[0]?.active_count ?? 0) >= MAX_ACTIVE_BUSINESSES_PER_OWNER) {
    throw new BusinessCreationLimitError();
  }
}

async function getJoinRateLimitRetryAfter(
  client: BusinessRegistryClient,
  keys: string[],
): Promise<number | null> {
  const result = await client.query(
    `SELECT GREATEST(
       1,
       CEIL(EXTRACT(EPOCH FROM (
         oldest_attempt_at + interval '${JOIN_FAILURE_WINDOW}' - now()
       )))::int
     ) AS retry_after_seconds
     FROM (
       SELECT MIN(attempted_at) AS oldest_attempt_at
       FROM public.business_join_attempts
       WHERE key_hash = ANY($1::text[])
         AND attempted_at > now() - interval '${JOIN_FAILURE_WINDOW}'
       GROUP BY key_hash
       HAVING COUNT(*) >= $2
     ) AS blocked_keys`,
    [keys, JOIN_FAILURE_LIMIT],
  );
  if (!result.rows.length) return null;
  return Math.max(...result.rows.map((row) => Number(row.retry_after_seconds) || 1));
}

async function recordJoinFailure(client: BusinessRegistryClient, keys: string[]): Promise<void> {
  const values = keys.flatMap((key) => [randomUUID(), key]);
  const valueRows = keys.map((_, index) =>
    `($${index * 2 + 1}::uuid, $${index * 2 + 2}, now())`,
  );
  await client.query(
    `WITH expired AS (
       DELETE FROM public.business_join_attempts AS attempts
       WHERE attempts.id IN (
         SELECT id
         FROM public.business_join_attempts
         WHERE attempted_at <= now() - interval '${JOIN_FAILURE_WINDOW}'
         ORDER BY attempted_at
         LIMIT 100
       )
       RETURNING id
     )
     INSERT INTO public.business_join_attempts (id, key_hash, attempted_at)
     VALUES ${valueRows.join(", ")}`,
    values,
  );
}

function makeJoinCode(): string {
  return String(randomInt(1_000_000_000, 10_000_000_000));
}

export async function listBusinessesForIdentity(
  userId: string,
  isPlatformAdmin: boolean,
): Promise<BusinessSummary[]> {
  return withBusinessRegistryClient((client) =>
    listBusinessesForIdentityWithClient(client, userId, isPlatformAdmin),
  );
}

export async function listBusinessesForIdentityWithClient(
  client: BusinessRegistryClient,
  userId: string,
  isPlatformAdmin: boolean,
): Promise<BusinessSummary[]> {
  if (isPlatformAdmin) {
    const result = await client.query(
      `SELECT id::text, name, owner_user_id
       FROM public.businesses
       WHERE active = true
       ORDER BY created_at, id`,
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: String(row.owner_user_id) === userId ? "owner" : "platform_admin",
    }));
  }
  const result = await client.query(
    `SELECT DISTINCT b.id::text, b.name,
       CASE WHEN m.role = 'owner' THEN 'owner' ELSE 'employee' END AS role
     FROM public.businesses b
     JOIN public.business_memberships m ON m.business_id = b.id
     WHERE b.active = true AND m.active = true
        AND m.user_id = $1
     ORDER BY b.name, b.id::text`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    role: row.role === "owner" ? "owner" : "employee",
  }));
}

export async function listCurrentBusinessMembers(input: {
  businessId: string;
  ownerUserId: string;
  isPlatformAdmin: boolean;
}): Promise<BusinessMemberSummary[]> {
  return withBusinessRegistryClient((client) =>
    listCurrentBusinessMembersWithClient(client, input),
  );
}

export async function listCurrentBusinessMembersWithClient(
  client: BusinessRegistryClient,
  input: { businessId: string; ownerUserId: string; isPlatformAdmin: boolean },
): Promise<BusinessMemberSummary[]> {
  const result = await client.query(
    `SELECT lower(m.email) AS email, m.role
     FROM public.business_memberships AS m
     JOIN public.businesses AS b ON b.id = m.business_id
     WHERE m.business_id = $1::uuid
       AND m.active = true
       AND b.active = true
       AND (b.owner_user_id = $2 OR $3::boolean = true)
     ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, lower(m.email)`,
    [input.businessId, input.ownerUserId, input.isPlatformAdmin],
  );

  return result.rows.map((row) => {
    const role = String(row.role);
    if (role !== "owner" && role !== "employee") {
      throw new Error("Business registry returned an unsupported membership role.");
    }
    return {
      email: String(row.email).trim().toLowerCase(),
      role,
    };
  });
}

export async function restorePendingDefaultBusinessOwnership(input: {
  userId: string;
  verifiedEmail: string;
}): Promise<boolean> {
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  if (!input.userId.trim() || !isVerifiedAdminIdentity(
    { email: input.verifiedEmail, verified: true },
    adminEmail,
  )) {
    return false;
  }
  return withBusinessRegistryClient((client) =>
    restorePendingDefaultBusinessOwnershipWithClient(client, {
      userId: input.userId,
      verifiedEmail: input.verifiedEmail,
      adminEmail,
    }),
  );
}

export async function restorePendingDefaultBusinessOwnershipWithClient(
  client: BusinessRegistryClient,
  input: {
    userId: string;
    verifiedEmail: string;
    adminEmail: string | null | undefined;
  },
): Promise<boolean> {
  const email = normalizeEmail(input.verifiedEmail);
  const adminEmail = normalizeEmail(input.adminEmail);
  if (!input.userId.trim() || !isVerifiedAdminIdentity(
    { email, verified: true },
    adminEmail,
  )) {
    return false;
  }

  const pendingOwnerId = `pending-owner:${adminEmail}`;
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`so-cong:restore-owner:${DEFAULT_BUSINESS_ID}`],
    );
    const current = await client.query(
      `SELECT owner_user_id, owner_email
       FROM public.businesses
       WHERE id = $1::uuid AND active = true
       FOR UPDATE`,
      [DEFAULT_BUSINESS_ID],
    );
    const business = current.rows[0];
    if (
      !business
      || String(business.owner_user_id) !== pendingOwnerId
      || normalizeEmail(String(business.owner_email ?? "")) !== adminEmail
    ) {
      await client.query("ROLLBACK");
      return false;
    }

    const existingOwner = await client.query(
      `SELECT user_id
       FROM public.business_memberships
       WHERE business_id = $1::uuid AND role = 'owner' AND user_id <> $2
       LIMIT 1`,
      [DEFAULT_BUSINESS_ID, input.userId],
    );
    if (existingOwner.rows.length) {
      await client.query("ROLLBACK");
      return false;
    }

    const conflictingMembership = await client.query(
      `SELECT user_id
       FROM public.business_memberships
       WHERE business_id = $1::uuid
         AND lower(btrim(email)) = $2
         AND user_id <> $3
       LIMIT 1`,
      [DEFAULT_BUSINESS_ID, adminEmail, input.userId],
    );
    if (conflictingMembership.rows.length) {
      await client.query("ROLLBACK");
      return false;
    }

    const updated = await client.query(
      `UPDATE public.businesses
       SET owner_user_id = $2, owner_email = $3
       WHERE id = $1::uuid AND active = true
         AND owner_user_id = $4 AND lower(btrim(owner_email)) = $3
       RETURNING id`,
      [DEFAULT_BUSINESS_ID, input.userId, adminEmail, pendingOwnerId],
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      `INSERT INTO public.business_users (user_id, email)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET email = EXCLUDED.email, updated_at = now()`,
      [input.userId, adminEmail],
    );
    await client.query(
      `INSERT INTO public.business_memberships
        (id, business_id, user_id, email, role, active)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'owner', true)
       ON CONFLICT (business_id, user_id) DO UPDATE
         SET email = EXCLUDED.email, role = 'owner', active = true`,
      [randomUUID(), DEFAULT_BUSINESS_ID, input.userId, adminEmail],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function createBusinessForOwner(input: {
  userId: string;
  email: string;
  name: string;
}): Promise<{ business: BusinessSummary; joinCode: string }> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) {
    throw new Error("Tên doanh nghiệp phải có từ 2 đến 120 ký tự.");
  }
  const id = randomUUID();
  const membershipId = randomUUID();
  const joinCode = makeJoinCode();
  await withBusinessRegistryClient(async (client) => {
    await client.query("BEGIN");
    try {
      const email = input.email.trim().toLowerCase();
      await ensureBusinessCreationCapacity(client, input.userId);
      await client.query(
        `INSERT INTO public.business_users (user_id, email)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`,
        [input.userId, email],
      );
      await client.query(
        `INSERT INTO public.businesses
          (id, name, owner_user_id, owner_email, join_code_hash, active)
         VALUES ($1::uuid, $2, $3, $4, $5, true)`,
        [id, name, input.userId, email, hashJoinCode(joinCode)],
      );
      await client.query(
        `INSERT INTO public.business_memberships
          (id, business_id, user_id, email, role, active)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'owner', true)`,
        [membershipId, id, input.userId, email],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
  return { business: { id, name, role: "owner" }, joinCode };
}

export async function joinBusinessByCode(input: {
  userId: string;
  email: string;
  code: string;
  ipAddress: string;
}): Promise<JoinBusinessResult> {
  const secret = process.env.APP_CLERK_SECRET_KEY?.trim();
  if (!secret) throw new Error("Business join rate-limit key is not configured.");
  return withBusinessRegistryClient((client) =>
    joinBusinessByCodeWithClient(client, input, secret),
  );
}

export async function joinBusinessByCodeWithClient(
  client: BusinessRegistryClient,
  input: { userId: string; email: string; code: string; ipAddress: string },
  hashSecret: string,
): Promise<JoinBusinessResult> {
  const code = input.code.replace(/\s+/g, "");
  if (!/^\d{10}$/.test(code)) return { kind: "invalid-code" };
  const attemptKeys = getJoinAttemptKeys(input, hashSecret);

  await client.query("BEGIN");
  try {
    await lockJoinAttemptKeys(client, attemptKeys);
    const retryAfterSeconds = await getJoinRateLimitRetryAfter(client, attemptKeys);
    if (retryAfterSeconds !== null) {
      await client.query("ROLLBACK");
      return { kind: "rate-limited", retryAfterSeconds };
    }

    const found = await client.query(
      `SELECT id::text, name FROM public.businesses
       WHERE active = true AND join_code_hash = $1
       FOR SHARE`,
      [hashJoinCode(code)],
    );
    const row = found.rows[0];
    if (!row) {
      await recordJoinFailure(client, attemptKeys);
      await client.query("COMMIT");
      return { kind: "invalid-code" };
    }

    const email = input.email.trim().toLowerCase();
    await client.query(
      `INSERT INTO public.business_users (user_id, email)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`,
      [input.userId, email],
    );
    // Rejoining restores only the employee membership; this path never creates manager grants.
    await client.query(
      `INSERT INTO public.business_memberships
        (id, business_id, user_id, email, role, active)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'employee', true)
       ON CONFLICT (business_id, user_id) DO UPDATE
         SET email = EXCLUDED.email, active = true
       WHERE business_memberships.role = 'employee'`,
      [randomUUID(), String(row.id), input.userId, email],
    );
    await client.query("COMMIT");
    return {
      kind: "joined",
      business: { id: String(row.id), name: String(row.name), role: "employee" },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function rotateBusinessJoinCode(input: {
  businessId: string;
  ownerUserId: string;
}): Promise<string | null> {
  return withBusinessRegistryClient((client) =>
    rotateBusinessJoinCodeWithClient(client, input),
  );
}

export async function rotateBusinessJoinCodeWithClient(
  client: BusinessRegistryClient,
  input: { businessId: string; ownerUserId: string },
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(input.businessId)) return null;
  const joinCode = makeJoinCode();
  const updated = await client.query(
    `UPDATE public.businesses SET join_code_hash = $3
     WHERE id = $1::uuid AND owner_user_id = $2 AND active = true
     RETURNING id`,
    [input.businessId, input.ownerUserId, hashJoinCode(joinCode)],
  );
  return updated.rowCount ? joinCode : null;
}
