import assert from "node:assert/strict";
import test from "node:test";
import { cardResponse, cardValues, validatedCardPayment } from "./massage-cards";
import { treatmentCardsTable, type CardTopUpRow } from "@workspace/db";

test("card response preserves balances and payment history fields", () => {
  const createdAt = new Date("2026-11-09T08:00:00.000Z");
  const card: typeof treatmentCardsTable.$inferSelect = {
    id: 17,
    businessId: "00000000-0000-4000-8000-000000000001",
    customerName: "Nguyễn An",
    phone: "0900000000",
    serviceType: "Massage",
    totalMinutes: 180,
    purchaseAmount: 200000,
    purchaseDate: "2026-11-08",
    purchasePaymentMethod: "cash",
    sellerName: "Chủ cơ sở",
    note: "",
    createdAt,
    deletedAt: null,
    firstUsedAt: createdAt,
  };
  const topUp: CardTopUpRow = {
    id: 9,
    businessId: card.businessId,
    cardId: card.id,
    minutes: 60,
    amount: 50000,
    paymentDate: "2026-11-09",
    paymentMethod: "transfer",
    sellerName: "Nhân viên",
    source: "topup",
    note: "",
    createdAt,
  };

  const response = cardResponse(card, 90, [topUp]);
  assert.equal(response.remainingMinutes, 90);
  assert.equal(response.totalPaidAmount, 250000);
  assert.equal(response.hasBeenUsed, true);
  assert.equal(response.topUps[0]?.createdAt, createdAt.toISOString());
});

test("card value and tender helpers preserve their existing normalization", () => {
  const values = cardValues({
    customerName: "  Nguyễn   An ",
    phone: " 0900000000 ",
    serviceType: " Massage ",
    totalMinutes: 120,
    purchaseAmount: 200000,
    purchaseDate: "2026-11-09",
    purchasePaymentMethod: "cash",
    sellerName: " Chủ cơ sở ",
    note: " ghi chú ",
  });

  assert.equal(values.customerName, "Nguyễn   An");
  assert.equal(values.phone, "0900000000");
  assert.equal(values.serviceType, "Massage");
  assert.equal(values.note, "ghi chú");
  assert.deepEqual(validatedCardPayment({
    purchasePaymentMethod: "transfer",
    sellerName: " Nhân viên ",
  }), {
    purchasePaymentMethod: "transfer",
    sellerName: "Nhân viên",
  });
});

test("invalid card dates and payment methods remain rejected", () => {
  assert.throws(() => cardValues({
    customerName: "Khách",
    phone: "0900000000",
    serviceType: "Massage",
    totalMinutes: 60,
    purchaseAmount: 0,
    purchaseDate: "2026-02-30",
  }), /Ngày không hợp lệ/);
  assert.throws(() => validatedCardPayment({
    purchasePaymentMethod: "cashless",
    sellerName: "Chủ cơ sở",
  }), /Chọn tiền mặt hoặc chuyển khoản/);
});
