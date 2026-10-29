import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPartitionedSessionDeleteMutations,
  escapeLikePattern,
  identityPhone,
  resolveSessionCustomerHourlyRate,
  resolveSessionHourlyRate,
  sameAppointmentCustomer,
  serviceTypeHasHistory,
} from "./massage";

test("appointment identity prefers a valid phone and does not match duplicate names with different numbers", () => {
  const appointment = (customerName: string, phone: string) => ({ customerName, phone });
  const card = (customerName: string, phone: string) => ({ customerName, phone });

  assert.equal(
    sameAppointmentCustomer(appointment("Khách trùng tên", "0900000001"), card("Khách trùng tên", "0900000002")),
    false,
  );
  assert.equal(
    sameAppointmentCustomer(appointment("Tên khác", "+84 900 000 001"), card("Khách", "0900000001")),
    true,
  );
  assert.equal(sameAppointmentCustomer(appointment("  Nguyễn   An ", "abc"), card("nguyễn an", "x")), true);
  assert.equal(sameAppointmentCustomer(appointment("Nguyễn An", "0900000001"), card("Nguyễn An", "")), false);
});

test("attendance SQL search treats SQL wildcard characters literally", () => {
  assert.equal(escapeLikePattern("100%_ok\\done"), "100\\%\\_ok\\\\done");
});

test("card identity normalizes +84 and 0084 phone prefixes to the local 0 prefix", () => {
  assert.equal(identityPhone("+84 912 345 678"), identityPhone("0912345678"));
  assert.equal(identityPhone("0084 912 345 678"), identityPhone("0912345678"));
  assert.equal(identityPhone("84912345678"), identityPhone("0912345678"));
});

test("editing a zero-rate card session uses the current service wage without changing saved rates", () => {
  assert.equal(resolveSessionHourlyRate(0, 85_000, true), 85_000);
  assert.equal(resolveSessionHourlyRate(75_000, 85_000, true), 75_000);
  assert.equal(resolveSessionHourlyRate(75_000, 85_000, false), 85_000);
  assert.equal(resolveSessionCustomerHourlyRate(0, 120_000, true), 120_000);
  assert.equal(resolveSessionCustomerHourlyRate(90_000, 120_000, true), 90_000);
  assert.equal(resolveSessionCustomerHourlyRate(90_000, 120_000, false), 120_000);
});

test("service deletion history guard sees both live sessions and permanent card-use history", () => {
  assert.equal(serviceTypeHasHistory(3, [{ serviceTypeId: 3 }], []), true);
  assert.equal(serviceTypeHasHistory(3, [], [{ serviceTypeId: 3 }]), true);
  assert.equal(serviceTypeHasHistory(3, [{ serviceTypeId: 4 }], [{ serviceTypeId: null }]), false);
});

test("partitioned card-session deletion only removes the service session", () => {
  const mutations = buildPartitionedSessionDeleteMutations(17);
  assert.deepEqual(mutations.map(({ entityType, action }) => ({ entityType, action })), [
    { entityType: "service_sessions", action: "delete" },
  ]);
});
