import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listBusinessesForIdentityWithClient,
  listCurrentBusinessMembersWithClient,
} from "./business-tenancy";

test("lists an identity's businesses with DISTINCT-safe ordering", async () => {
  let queryText = "";
  const client = {
    async query(text: string) {
      queryText = text;
      return {
        rows: [{ id: "business-a", name: "Cơ sở A", role: "employee" }],
      };
    },
  };

  const businesses = await listBusinessesForIdentityWithClient(client, "user-a", false);

  assert.deepEqual(businesses, [{
    id: "business-a",
    name: "Cơ sở A",
    role: "employee",
  }]);
  assert.match(queryText, /SELECT DISTINCT b\.id::text/);
  assert.match(queryText, /ORDER BY b\.name, b\.id::text/);
});

test("lists only active members from the selected business for its owner", async () => {
  let queryText = "";
  let queryValues: unknown[] = [];
  const client = {
    async query(text: string, values: unknown[] = []) {
      queryText = text;
      queryValues = values;
      return {
        rows: [
          { email: "owner@example.com", role: "owner" },
          { email: "staff@example.com", role: "employee" },
        ],
      };
    },
  };

  const members = await listCurrentBusinessMembersWithClient(client, {
    businessId: "business-a",
    ownerUserId: "owner-user-a",
    isPlatformAdmin: false,
  });

  assert.deepEqual(members, [
    { email: "owner@example.com", role: "owner" },
    { email: "staff@example.com", role: "employee" },
  ]);
  assert.match(queryText, /m\.business_id = \$1::uuid/);
  assert.match(queryText, /m\.active = true/);
  assert.match(queryText, /b\.active = true/);
  assert.match(queryText, /b\.owner_user_id = \$2/);
  assert.deepEqual(queryValues, ["business-a", "owner-user-a", false]);
});

test("allows the platform admin path while retaining the business filter", async () => {
  let queryValues: unknown[] = [];
  const client = {
    async query(_text: string, values: unknown[] = []) {
      queryValues = values;
      return { rows: [{ email: "member@example.com", role: "employee" }] };
    },
  };

  const members = await listCurrentBusinessMembersWithClient(client, {
    businessId: "business-b",
    ownerUserId: "admin-user",
    isPlatformAdmin: true,
  });

  assert.deepEqual(members, [{ email: "member@example.com", role: "employee" }]);
  assert.deepEqual(queryValues, ["business-b", "admin-user", true]);
});

test("rejects unexpected membership roles instead of returning them", async () => {
  const client = {
    async query() {
      return { rows: [{ email: "member@example.com", role: "unknown" }] };
    },
  };

  await assert.rejects(
    listCurrentBusinessMembersWithClient(client, {
      businessId: "business-a",
      ownerUserId: "owner-user-a",
      isPlatformAdmin: false,
    }),
    /unsupported membership role/,
  );
});
