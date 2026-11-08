import { createHash, randomInt, randomUUID } from "node:crypto";
import { withBusinessRegistryClient } from "@workspace/db";

export const DEFAULT_BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

export type BusinessRole = "owner" | "employee";
export type BusinessSummary = {
  id: string;
  name: string;
  role: BusinessRole | "platform_admin";
};

const hashJoinCode = (code: string) =>
  createHash("sha256").update(code, "utf8").digest("hex");

function makeJoinCode(): string {
  return String(randomInt(1_000_000_000, 10_000_000_000));
}

export async function listBusinessesForIdentity(
  userId: string,
  email: string,
  isPlatformAdmin: boolean,
): Promise<BusinessSummary[]> {
  return withBusinessRegistryClient(async (client) => {
    if (isPlatformAdmin) {
      const result = await client.query(
        `SELECT id::text, name FROM public.businesses WHERE active = true ORDER BY created_at, id`,
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        role: "platform_admin" as const,
      }));
    }
    const result = await client.query(
      `SELECT DISTINCT b.id::text, b.name,
         CASE WHEN m.role = 'owner' THEN 'owner' ELSE 'employee' END AS role
       FROM public.businesses b
       JOIN public.business_memberships m ON m.business_id = b.id
       WHERE b.active = true AND m.active = true
         AND (m.user_id = $1 OR lower(m.email) = lower($2))
       ORDER BY b.name, b.id`,
      [userId, email],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: row.role === "owner" ? "owner" : "employee",
    }));
  });
}

export async function businessesByIds(ids: readonly string[]): Promise<BusinessSummary[]> {
  const uniqueIds = [...new Set(ids)].filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
  );
  if (!uniqueIds.length) return [];
  return withBusinessRegistryClient(async (client) => {
    const result = await client.query(
      `SELECT id::text, name FROM public.businesses
       WHERE active = true AND id = ANY($1::uuid[]) ORDER BY name, id`,
      [uniqueIds],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: "employee" as const,
    }));
  });
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
      await client.query(
        `INSERT INTO public.businesses
          (id, name, owner_user_id, owner_email, join_code_hash, active)
         VALUES ($1::uuid, $2, $3, $4, $5, true)`,
        [id, name, input.userId, input.email.trim().toLowerCase(), hashJoinCode(joinCode)],
      );
      await client.query(
        `INSERT INTO public.business_memberships
          (id, business_id, user_id, email, role, active)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'owner', true)`,
        [membershipId, id, input.userId, input.email.trim().toLowerCase()],
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
}): Promise<BusinessSummary | null> {
  const code = input.code.replace(/\s+/g, "");
  if (!/^\d{10}$/.test(code)) return null;
  return withBusinessRegistryClient(async (client) => {
    await client.query("BEGIN");
    try {
      const found = await client.query(
        `SELECT id::text, name FROM public.businesses
         WHERE active = true AND join_code_hash = $1
         FOR SHARE`,
        [hashJoinCode(code)],
      );
      const row = found.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `INSERT INTO public.business_memberships
          (id, business_id, user_id, email, role, active)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'employee', true)
         ON CONFLICT (business_id, user_id) DO UPDATE
           SET email = EXCLUDED.email, active = true
         WHERE business_memberships.role = 'employee'`,
        [randomUUID(), String(row.id), input.userId, input.email.trim().toLowerCase()],
      );
      await client.query("COMMIT");
      return { id: String(row.id), name: String(row.name), role: "employee" };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

export async function rotateBusinessJoinCode(input: {
  businessId: string;
  ownerUserId: string;
}): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(input.businessId)) return null;
  const joinCode = makeJoinCode();
  const updated = await withBusinessRegistryClient((client) => client.query(
    `UPDATE public.businesses SET join_code_hash = $3
     WHERE id = $1::uuid AND owner_user_id = $2 AND active = true
     RETURNING id`,
    [input.businessId, input.ownerUserId, hashJoinCode(joinCode)],
  ));
  return updated.rowCount ? joinCode : null;
}
