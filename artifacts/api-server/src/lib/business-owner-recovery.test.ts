import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BUSINESS_ID, isVerifiedAdminIdentity, listBusinessesForIdentityWithClient, restorePendingDefaultBusinessOwnershipWithClient, rotateBusinessJoinCodeWithClient } from "./business-tenancy";
import { warnIfAdminEmailMissing } from "./owner-auth";

const ADMIN_EMAIL = "owner@example.com";
const ADMIN_USER_ID = "user_clerk_owner";
const PENDING_OWNER_ID = `pending-owner:${ADMIN_EMAIL}`;

type Membership = { user_id: string; email: string; role: string; active: boolean };
type BusinessRecord = {
  id: string;
  name: string;
  owner_user_id: string;
  owner_email: string;
  active: boolean;
  join_code_hash: string;
};

class FakeOwnerRegistryClient {
  business: BusinessRecord = {
    id: DEFAULT_BUSINESS_ID,
    name: "Cơ sở hiện tại",
    owner_user_id: PENDING_OWNER_ID,
    owner_email: ADMIN_EMAIL,
    active: true,
    join_code_hash: "old-code-hash",
  };
  users = new Map<string, string>();
  memberships: Membership[] = [];
  statements: string[] = [];
  failOnMembershipInsert = false;
  private snapshot: {
    business: BusinessRecord;
    users: Map<string, string>;
    memberships: Membership[];
  } | null = null;

  async query(sqlText: string, values: unknown[] = []) {
    const sql = sqlText.replace(/\s+/g, " ").trim();
    this.statements.push(sql);

    if (sql === "BEGIN") {
      this.snapshot = {
        business: { ...this.business },
        users: new Map(this.users),
        memberships: this.memberships.map((membership) => ({ ...membership })),
      };
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      this.snapshot = null;
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      if (this.snapshot) {
        this.business = this.snapshot.business;
        this.users = this.snapshot.users;
        this.memberships = this.snapshot.memberships;
        this.snapshot = null;
      }
      return { rows: [] };
    }
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };

    if (sql.startsWith("SELECT owner_user_id, owner_email FROM public.businesses")) {
      return this.business.active
        ? { rows: [{ owner_user_id: this.business.owner_user_id, owner_email: this.business.owner_email }] }
        : { rows: [] };
    }
    if (
      sql.startsWith("SELECT user_id FROM public.business_memberships")
      && sql.includes("role = 'owner'")
    ) {
      const businessId = String(values[0]);
      const excludedUserId = String(values[1]);
      const membership = this.memberships.find((candidate) =>
        candidate.role === "owner"
        && candidate.user_id !== excludedUserId
        && businessId === DEFAULT_BUSINESS_ID,
      );
      return { rows: membership ? [{ user_id: membership.user_id }] : [] };
    }
    if (
      sql.startsWith("SELECT user_id FROM public.business_memberships")
      && sql.includes("lower(btrim(email))")
    ) {
      const [businessId, email, excludedUserId] = values.map(String);
      const membership = this.memberships.find((candidate) =>
        businessId === DEFAULT_BUSINESS_ID
        && candidate.user_id !== excludedUserId
        && candidate.email.trim().toLowerCase() === email,
      );
      return { rows: membership ? [{ user_id: membership.user_id }] : [] };
    }
    if (sql.startsWith("UPDATE public.businesses SET owner_user_id")) {
      assert.match(sql, /owner_user_id = \$4/);
      const [businessId, userId, email, pendingOwnerId] = values.map(String);
      if (
        businessId !== this.business.id
        || !this.business.active
        || this.business.owner_user_id !== pendingOwnerId
        || this.business.owner_email.trim().toLowerCase() !== email
      ) {
        return { rows: [], rowCount: 0 };
      }
      this.business.owner_user_id = userId;
      this.business.owner_email = email;
      return { rows: [{ id: businessId }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO public.business_users")) {
      this.users.set(String(values[0]), String(values[1]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO public.business_memberships")) {
      if (this.failOnMembershipInsert) throw new Error("test membership insert failure");
      const [id, businessId, userId, email] = values.map(String);
      const existing = this.memberships.find((membership) =>
        membership.user_id === userId && businessId === DEFAULT_BUSINESS_ID,
      );
      if (existing) {
        existing.email = email;
        existing.role = "owner";
        existing.active = true;
      } else {
        this.memberships.push({ user_id: userId, email, role: "owner", active: true });
      }
      assert.ok(id);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT id::text, name, owner_user_id FROM public.businesses")) {
      if (!this.business.active) return { rows: [] };
      return {
        rows: [{
          id: this.business.id,
          name: this.business.name,
          owner_user_id: this.business.owner_user_id,
        }],
      };
    }
    if (sql.startsWith("UPDATE public.businesses SET join_code_hash")) {
      const [businessId, ownerUserId, joinCodeHash] = values.map(String);
      if (
        businessId !== this.business.id
        || ownerUserId !== this.business.owner_user_id
        || !this.business.active
      ) {
        return { rows: [], rowCount: 0 };
      }
      this.business.join_code_hash = joinCodeHash;
      return { rows: [{ id: businessId }], rowCount: 1 };
    }

    throw new Error(`Unexpected owner-recovery SQL: ${sql}`);
  }
}

const ownerRecoveryInput = {
  userId: ADMIN_USER_ID,
  verifiedEmail: ADMIN_EMAIL,
  adminEmail: ADMIN_EMAIL,
};

test("only a verified email matching ADMIN_EMAIL is considered the platform owner", () => {
  assert.equal(isVerifiedAdminIdentity({ email: ADMIN_EMAIL, verified: true }, ADMIN_EMAIL), true);
  assert.equal(isVerifiedAdminIdentity({ email: ADMIN_EMAIL, verified: false }, ADMIN_EMAIL), false);
  assert.equal(isVerifiedAdminIdentity({ email: "other@example.com", verified: true }, ADMIN_EMAIL), false);
  assert.equal(isVerifiedAdminIdentity({ email: ADMIN_EMAIL, verified: true }, undefined), false);
});

test("the matching owner claims the pending legacy business once and can rotate its code", async () => {
  const client = new FakeOwnerRegistryClient();
  const restored = await restorePendingDefaultBusinessOwnershipWithClient(client, ownerRecoveryInput);

  assert.equal(restored, true);
  assert.equal(client.business.owner_user_id, ADMIN_USER_ID);
  assert.equal(client.business.owner_email, ADMIN_EMAIL);
  assert.equal(client.users.get(ADMIN_USER_ID), ADMIN_EMAIL);
  assert.deepEqual(client.memberships, [{
    user_id: ADMIN_USER_ID,
    email: ADMIN_EMAIL,
    role: "owner",
    active: true,
  }]);
  assert.ok(client.statements.includes("COMMIT"));

  const businesses = await listBusinessesForIdentityWithClient(client, ADMIN_USER_ID, true);
  assert.deepEqual(businesses, [{
    id: DEFAULT_BUSINESS_ID,
    name: "Cơ sở hiện tại",
    role: "owner",
  }]);

  const newJoinCode = await rotateBusinessJoinCodeWithClient(client, {
    businessId: DEFAULT_BUSINESS_ID,
    ownerUserId: ADMIN_USER_ID,
  });
  assert.match(newJoinCode ?? "", /^\d{10}$/);
  assert.notEqual(client.business.join_code_hash, "old-code-hash");
});

test("email mismatch or missing ADMIN_EMAIL performs no database operation", async () => {
  for (const input of [
    { ...ownerRecoveryInput, verifiedEmail: "other@example.com" },
    { ...ownerRecoveryInput, adminEmail: undefined },
  ]) {
    const client = new FakeOwnerRegistryClient();
    assert.equal(await restorePendingDefaultBusinessOwnershipWithClient(client, input), false);
    assert.deepEqual(client.statements, []);
    assert.equal(client.business.owner_user_id, PENDING_OWNER_ID);
  }
});

test("a real owner or a conflicting owner membership is never replaced", async () => {
  const alreadyOwned = new FakeOwnerRegistryClient();
  alreadyOwned.business.owner_user_id = "existing-real-owner";
  assert.equal(await restorePendingDefaultBusinessOwnershipWithClient(alreadyOwned, ownerRecoveryInput), false);
  assert.equal(alreadyOwned.business.owner_user_id, "existing-real-owner");
  assert.equal(alreadyOwned.memberships.length, 0);

  const ownerMembershipExists = new FakeOwnerRegistryClient();
  ownerMembershipExists.memberships.push({
    user_id: "existing-real-owner",
    email: "existing-owner@example.com",
    role: "owner",
    active: true,
  });
  assert.equal(await restorePendingDefaultBusinessOwnershipWithClient(ownerMembershipExists, ownerRecoveryInput), false);
  assert.equal(ownerMembershipExists.business.owner_user_id, PENDING_OWNER_ID);
  assert.equal(ownerMembershipExists.users.size, 0);
});

test("owner and membership restoration roll back together if membership insertion fails", async () => {
  const client = new FakeOwnerRegistryClient();
  client.failOnMembershipInsert = true;

  await assert.rejects(
    restorePendingDefaultBusinessOwnershipWithClient(client, ownerRecoveryInput),
    /test membership insert failure/,
  );
  assert.equal(client.business.owner_user_id, PENDING_OWNER_ID);
  assert.equal(client.business.owner_email, ADMIN_EMAIL);
  assert.equal(client.users.size, 0);
  assert.equal(client.memberships.length, 0);
  assert.ok(client.statements.includes("ROLLBACK"));
});

test("missing ADMIN_EMAIL logs only a generic warning", () => {
  let warning = "";
  const didWarn = warnIfAdminEmailMissing(undefined, (message) => { warning = message; });

  assert.equal(didWarn, true);
  assert.match(warning, /ADMIN_EMAIL is missing/);
  assert.doesNotMatch(warning, /owner@example\.com|1111111111|secret-value/i);

  assert.equal(warnIfAdminEmailMissing(ADMIN_EMAIL, () => assert.fail("should not warn")), false);
});
