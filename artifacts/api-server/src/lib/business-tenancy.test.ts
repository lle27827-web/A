import assert from "node:assert/strict";
import test from "node:test";
import {
  getBusinessPrintProfileWithClient,
  updateBusinessPrintProfileWithClient,
} from "./business-tenancy";

function mockRegistryClient(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    client: {
      async query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rows };
      },
    },
  };
}

test("print profile read is restricted to the active business id", async () => {
  const { client, calls } = mockRegistryClient([{
    facility_name: "Cơ sở A",
    facility_address: "Địa chỉ A",
    facility_tax_code: "TAX-A",
    facility_phone: "0900000001",
  }]);

  const profile = await getBusinessPrintProfileWithClient(client, "tenant-a");

  assert.deepEqual(profile, {
    facilityName: "Cơ sở A",
    facilityAddress: "Địa chỉ A",
    facilityTaxCode: "TAX-A",
    facilityPhone: "0900000001",
  });
  assert.match(calls[0]!.text, /WHERE id = \$1::uuid AND active = true/);
  assert.deepEqual(calls[0]!.values, ["tenant-a"]);
  assert.doesNotMatch(calls[0]!.text, /SELECT \*/);
});

test("print profile write requires the selected business and its verified owner", async () => {
  const { client, calls } = mockRegistryClient([{
    facility_name: "Cơ sở B",
    facility_address: "Địa chỉ B",
    facility_tax_code: "TAX-B",
    facility_phone: "0900000002",
  }]);

  const profile = await updateBusinessPrintProfileWithClient(client, {
    businessId: "tenant-b",
    ownerUserId: "owner-b",
    profile: {
      facilityName: "Cơ sở B",
      facilityAddress: "Địa chỉ B",
      facilityTaxCode: "TAX-B",
      facilityPhone: "0900000002",
    },
  });

  assert.equal(profile?.facilityPhone, "0900000002");
  assert.match(calls[0]!.text, /WHERE id = \$1::uuid AND owner_user_id = \$2 AND active = true/);
  assert.deepEqual(calls[0]!.values, [
    "tenant-b",
    "owner-b",
    "Cơ sở B",
    "Địa chỉ B",
    "TAX-B",
    "0900000002",
  ]);
});

test("print profile write fails closed when the owner predicate matches no business", async () => {
  const { client } = mockRegistryClient([]);

  const profile = await updateBusinessPrintProfileWithClient(client, {
    businessId: "tenant-a",
    ownerUserId: "different-owner",
    profile: {
      facilityName: "",
      facilityAddress: "",
      facilityTaxCode: "",
      facilityPhone: "",
    },
  });

  assert.equal(profile, null);
});

test("join code storage uses a keyed, domain-separated HMAC", async () => {
  const { hashJoinCodeForStorage } = await import("./business-tenancy");
  const secret = "a-distinct-32-character-join-secret!";
  const first = hashJoinCodeForStorage("1234567890", secret);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, hashJoinCodeForStorage("1234567890", secret));
  assert.notEqual(first, hashJoinCodeForStorage("1234567891", secret));
  assert.notEqual(first, hashJoinCodeForStorage("1234567890", `${secret}x`));
});
