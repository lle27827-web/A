import assert from "node:assert/strict";
import test from "node:test";
import { escapeLikePattern, sameAppointmentCustomer } from "./massage";

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
