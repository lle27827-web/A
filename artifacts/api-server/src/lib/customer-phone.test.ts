import assert from "node:assert/strict";
import test from "node:test";
import { isMaskedCustomerPhone, maskCustomerPhone, matchesTreatmentCardSearch } from "./customer-phone";

test("non-owner phone masking keeps only the last three digits and masked phones are recognized", () => {
  const masked = maskCustomerPhone("+84 912 345 678");
  assert.equal(masked, "•••••••678");
  assert.equal(isMaskedCustomerPhone(masked), true);
  assert.equal(isMaskedCustomerPhone("0912345678"), false);
});

test("treatment-card phone search compares original numbers before masking", () => {
  const card = { customerName: "Khách", phone: "0912345678", serviceType: "Massage" };
  assert.equal(matchesTreatmentCardSearch(card, "+84 912 345 678"), true);
  assert.equal(matchesTreatmentCardSearch(card, "0912"), true);
  assert.equal(matchesTreatmentCardSearch(card, "Massage"), true);
  assert.equal(matchesTreatmentCardSearch(card, "0900000000"), false);
});
