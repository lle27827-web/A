import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  cardTopUpsTable,
  cardUsageHistoryTable,
  serviceSessionsTable,
  treatmentCardsTable,
  type CardTopUpRow,
} from "@workspace/db";
import type { TreatmentCardInput } from "@workspace/api-zod";
import { MassageError, type Tx, validDate } from "./massage-common";

export function cardResponse(
  row: typeof treatmentCardsTable.$inferSelect,
  usedMinutes = 0,
  topUps: CardTopUpRow[] = [],
) {
  return {
    ...row,
    phone: row.phone,
    usedMinutes,
    hasBeenUsed: Boolean(row.firstUsedAt) || usedMinutes > 0,
    remainingMinutes: row.totalMinutes - usedMinutes,
    totalPaidAmount: row.purchaseAmount + topUps.reduce((sum, payment) => sum + payment.amount, 0),
    topUps: topUps.map((payment) => ({ ...payment, createdAt: payment.createdAt.toISOString() })),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function cardWithHistory(
  tx: Tx,
  row: typeof treatmentCardsTable.$inferSelect,
  used = 0,
) {
  const topUps = await tx.select().from(cardTopUpsTable).where(and(
    eq(cardTopUpsTable.cardId, row.id),
    eq(cardTopUpsTable.businessId, row.businessId),
  ))
    .orderBy(desc(cardTopUpsTable.paymentDate), desc(cardTopUpsTable.id));
  return cardResponse(row, used, topUps);
}

export async function creditCard(
  tx: Tx,
  card: typeof treatmentCardsTable.$inferSelect,
  minutes: number,
  amount: number,
  paymentDate: string,
  source: string,
  note = "",
  paymentMethod: "cash" | "transfer" | null = null,
  sellerName: string | null = null,
) {
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 600000 ||
      !Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000) {
    throw new MassageError(400, "Số giờ hoặc số tiền nạp không hợp lệ.");
  }
  if (card.totalMinutes + minutes > 600000) {
    throw new MassageError(400, "Tổng số giờ của thẻ không được vượt quá 10.000 giờ.");
  }
  validDate(paymentDate);
  await tx.insert(cardTopUpsTable).values({
    businessId: card.businessId,
    cardId: card.id,
    minutes,
    amount,
    paymentDate,
    source,
    note,
    paymentMethod,
    sellerName,
  });
  const [row] = await tx.update(treatmentCardsTable).set({ totalMinutes: card.totalMinutes + minutes })
    .where(and(
      eq(treatmentCardsTable.id, card.id),
      eq(treatmentCardsTable.businessId, card.businessId),
    )).returning();
  return cardWithHistory(tx, row, await usedMinutes(tx, row.id, undefined, row.businessId));
}

export async function usedMinutes(
  tx: Tx,
  cardId: number,
  excludeId?: number,
  businessId = "00000000-0000-4000-8000-000000000001",
) {
  const [live] = await tx.select({ used: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}), 0)` })
    .from(serviceSessionsTable)
    .where(and(
      eq(serviceSessionsTable.cardId, cardId),
      eq(serviceSessionsTable.businessId, businessId),
      excludeId ? ne(serviceSessionsTable.id, excludeId) : undefined,
    ));
  const [archived] = await tx.select({ used: sql<number>`coalesce(sum(${cardUsageHistoryTable.minutes}), 0)` })
    .from(cardUsageHistoryTable).where(and(
      eq(cardUsageHistoryTable.cardId, cardId),
      eq(cardUsageHistoryTable.businessId, businessId),
    ));
  return Number(live.used) + Number(archived.used);
}

export type CardValueInput = Omit<TreatmentCardInput, "purchasePaymentMethod" | "sellerName"> & {
  purchasePaymentMethod?: string | null;
  sellerName?: string | null;
};

export function cardValues(input: CardValueInput) {
  validDate(input.purchaseDate);
  const customerName = input.customerName.trim();
  const serviceType = input.serviceType.trim();
  const phone = input.phone.trim();
  if (!customerName || !serviceType || !phone) {
    throw new MassageError(400, "Cần tên khách, số điện thoại và loại dịch vụ.");
  }
  const { mergeTargetId: _confirmation, ...data } = input;
  return { ...data, customerName, serviceType, phone, note: input.note?.trim() ?? "" };
}

export function validatedCardPayment(input: { purchasePaymentMethod?: string | null; sellerName?: string | null }) {
  const paymentMethod = input.purchasePaymentMethod;
  const sellerName = input.sellerName?.trim() ?? "";
  if (paymentMethod !== "cash" && paymentMethod !== "transfer") {
    throw new MassageError(400, "Chọn tiền mặt hoặc chuyển khoản cho giao dịch thẻ.");
  }
  if (!sellerName || sellerName.length > 120) {
    throw new MassageError(400, "Nhập tên người bán hoặc nạp thẻ.");
  }
  return { purchasePaymentMethod: paymentMethod as "cash" | "transfer", sellerName };
}
