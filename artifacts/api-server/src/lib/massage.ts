import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { cardTopUpsTable, db, membersTable, serviceSessionsTable, treatmentCardsTable, serviceTypesTable, type CardTopUpRow } from "@workspace/db";
import type { ServiceSessionInput, TreatmentCardInput, TreatmentCardUpdate } from "@workspace/api-zod";

export class MassageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function validDate(value: string) {
  const d = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(d.getTime()) ||
      d.toISOString().slice(0, 10) !== value || d.getUTCFullYear() < 1 || d.getUTCFullYear() > 9998) {
    throw new MassageError(400, "Ngày không hợp lệ.");
  }
  return value;
}

export function monthBounds(month: string) {
  const start = validDate(`${month}-01`);
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { start, end: d.toISOString().slice(0, 10) };
}

export function sessionResponse(row: typeof serviceSessionsTable.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
export function cardResponse(row: typeof treatmentCardsTable.$inferSelect, usedMinutes = 0, topUps: CardTopUpRow[] = []) {
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
async function cardWithHistory(tx: Tx, row: typeof treatmentCardsTable.$inferSelect, used = 0) {
  const topUps = await tx.select().from(cardTopUpsTable).where(eq(cardTopUpsTable.cardId, row.id))
    .orderBy(desc(cardTopUpsTable.paymentDate), desc(cardTopUpsTable.id));
  return cardResponse(row, used, topUps);
}
export function currentBusinessDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const identityText = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
const identityPhone = (value: string) => value.replace(/\D/g, "") || identityText(value);

async function creditCard(tx: Tx, card: typeof treatmentCardsTable.$inferSelect, minutes: number, amount: number,
  paymentDate: string, source: string, note = "") {
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 600000 ||
      !Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) {
    throw new MassageError(400, "Số giờ hoặc số tiền nạp không hợp lệ.");
  }
  if (card.totalMinutes + minutes > 600000) {
    throw new MassageError(400, "Tổng số giờ của thẻ không được vượt quá 10.000 giờ.");
  }
  validDate(paymentDate);
  await tx.insert(cardTopUpsTable).values({ cardId: card.id, minutes, amount, paymentDate, source, note });
  const [row] = await tx.update(treatmentCardsTable).set({ totalMinutes: card.totalMinutes + minutes })
    .where(eq(treatmentCardsTable.id, card.id)).returning();
  return cardWithHistory(tx, row, await usedMinutes(tx, row.id));
}
async function usedMinutes(tx: Tx, cardId: number, excludeId?: number) {
  const [row] = await tx.select({ used: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}), 0)` })
    .from(serviceSessionsTable)
    .where(and(eq(serviceSessionsTable.cardId, cardId), excludeId ? ne(serviceSessionsTable.id, excludeId) : undefined));
  return Number(row.used);
}
function cardValues(input: TreatmentCardInput) {
  validDate(input.purchaseDate);
  const customerName = input.customerName.trim();
  const serviceType = input.serviceType.trim();
  const phone = input.phone.trim();
  if (!customerName || !serviceType || !phone) throw new MassageError(400, "Cần tên khách, số điện thoại và loại dịch vụ.");
  return { ...input, customerName, serviceType, phone, note: input.note?.trim() ?? "" };
}
export async function createCard(input: TreatmentCardInput) {
  const values = cardValues(input);
  return db.transaction(async (tx) => {
    const identity = [identityText(values.customerName), identityPhone(values.phone), identityText(values.serviceType)];
    // Serialize identical sale requests even when no matching card exists yet.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(identity)}, 0))`);
    const candidates = await tx.select().from(treatmentCardsTable).where(and(
      isNull(treatmentCardsTable.deletedAt),
      sql`lower(normalize(regexp_replace(btrim(${treatmentCardsTable.customerName}), '[[:space:]]+', ' ', 'g'), NFC)) = ${identity[0]}`,
      sql`lower(normalize(regexp_replace(btrim(${treatmentCardsTable.serviceType}), '[[:space:]]+', ' ', 'g'), NFC)) = ${identity[2]}`,
    )).orderBy(asc(treatmentCardsTable.id)).for("update");
    const existing = candidates.find((card) => identityPhone(card.phone) === identity[1]);
    if (existing) {
      return { ...await creditCard(tx, existing, values.totalMinutes, values.purchaseAmount, values.purchaseDate,
        "merged_sale", values.note), mergedIntoExisting: true };
    }
    const [row] = await tx.insert(treatmentCardsTable).values(values).returning();
    return { ...cardResponse(row), mergedIntoExisting: false };
  });
}
export async function updateCard(id: number, input: TreatmentCardUpdate) {
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, id)).for("update");
    if (!old || old.deletedAt) throw new MassageError(404, "Không tìm thấy thẻ.");
    const used = await usedMinutes(tx, id);
    const values = cardValues({ ...old, ...input });
    if (values.totalMinutes < used) throw new MassageError(409, "Tổng giờ của thẻ không thể thấp hơn số giờ đã sử dụng.");
    const [topUpTotal] = await tx.select({ minutes: sql<number>`coalesce(sum(${cardTopUpsTable.minutes}), 0)` })
      .from(cardTopUpsTable).where(eq(cardTopUpsTable.cardId, id));
    if (values.totalMinutes < Number(topUpTotal.minutes)) {
      throw new MassageError(409, "Tổng giờ không thể thấp hơn số giờ đã nạp trong lịch sử.");
    }
    const [row] = await tx.update(treatmentCardsTable).set({
      customerName: values.customerName, phone: values.phone, serviceType: values.serviceType,
      totalMinutes: values.totalMinutes, purchaseAmount: values.purchaseAmount,
      purchaseDate: values.purchaseDate, note: values.note,
    }).where(eq(treatmentCardsTable.id, id)).returning();
    return cardWithHistory(tx, row, used);
  });
}
export async function deleteCard(id: number) {
  await db.transaction(async (tx) => {
    const [card] = await tx.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, id)).for("update");
    if (!card || card.deletedAt) throw new MassageError(404, "Không tìm thấy thẻ.");
    const [visit] = await tx.select({ id: serviceSessionsTable.id }).from(serviceSessionsTable)
      .where(eq(serviceSessionsTable.cardId, id)).limit(1);
    if (card.firstUsedAt || visit) {
      throw new MassageError(409, "Thẻ đã có lượt sử dụng nên không thể xóa.");
    }
    // Preserve the audit record; live lists, balances and reports exclude it.
    await tx.update(treatmentCardsTable).set({ deletedAt: new Date() }).where(eq(treatmentCardsTable.id, id));
  });
}

export async function deleteMember(id: number) {
  await db.transaction(async (tx) => {
    const [member] = await tx.select({ id: membersTable.id, deletedAt: membersTable.deletedAt }).from(membersTable)
      .where(eq(membersTable.id, id)).for("update");
    if (!member) throw new MassageError(404, "Không tìm thấy nhân viên.");
    if (!member.deletedAt) await tx.update(membersTable).set({ deletedAt: sql`clock_timestamp()` }).where(eq(membersTable.id, id));
  });
}

/** Additive update, serialized with usage/edit operations to avoid lost hours. */
export async function addCardHours(id: number, minutes: number, amount: number) {
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 600000) {
    throw new MassageError(400, "Số giờ nạp phải lớn hơn 0 và không quá 10.000 giờ.");
  }
  return db.transaction(async (tx) => {
    const [card] = await tx.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, id)).for("update");
    if (!card || card.deletedAt) throw new MassageError(404, "Không tìm thấy thẻ.");
    return creditCard(tx, card, minutes, amount, currentBusinessDate(), "topup");
  });
}

// Lock the session and affected cards in a consistent order. Card row locks
// serialize balance checks so simultaneous requests cannot overspend hours.
export async function saveSession(input: ServiceSessionInput, id?: number) {
  validDate(input.workDate);
  return db.transaction(async (tx) => {
    const [old] = id ? await tx.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, id)).for("update") : [];
    if (id && !old) throw new MassageError(404, "Không tìm thấy lượt phục vụ.");
    const cardId = input.cardId ?? null;
    const ids = [...new Set([old?.cardId, cardId].filter((n): n is number => n !== null && n !== undefined))].sort((a, b) => a - b);
    let card: typeof treatmentCardsTable.$inferSelect | undefined;
    for (const lockId of ids) {
      const [row] = await tx.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, lockId)).for("update");
      if (!row) throw new MassageError(404, "Không tìm thấy thẻ đã chọn.");
      if (lockId === cardId) card = row;
    }
    if (card?.deletedAt) throw new MassageError(404, "Thẻ đã bị xóa, không thể ghi thêm lượt sử dụng.");
    const [member] = await tx.select().from(membersTable).where(eq(membersTable.id, input.memberId)).for("share");
    if (!member || (member.deletedAt && old?.memberId !== member.id)) throw new MassageError(404, "Không tìm thấy kỹ thuật viên đang hoạt động.");
    const sameEmployee = old?.memberId === member.id;
    const serviceTypeId = input.serviceTypeId ?? null;
    const [service] = serviceTypeId !== null
      ? await tx.select().from(serviceTypesTable).where(eq(serviceTypesTable.id, serviceTypeId)).for("share")
      : [];
    if (serviceTypeId !== null && !service) throw new MassageError(404, "Loại hình dịch vụ đã bị xóa. Hãy chọn dịch vụ khác.");
    if (!old && !service) throw new MassageError(400, "Hãy chọn loại hình dịch vụ để tính lương.");
    const sameService = old && old.serviceTypeId === serviceTypeId;
    const rate = sameService ? old.hourlyRate : service?.hourlyRate;
    const customerRate = sameService ? old.customerHourlyRate : service?.customerHourlyRate;
    if (!rate || rate <= 0) throw new MassageError(400, "Hãy chọn dịch vụ có mức lương mỗi giờ hợp lệ.");
    if (cardId === null && (!customerRate || customerRate <= 0) && (!old || !sameService)) {
      throw new MassageError(400, "Hãy cài giá khách trả mỗi giờ cho dịch vụ trước khi ghi ca khách lẻ.");
    }
    if (card && await usedMinutes(tx, card.id, id) + input.minutes > card.totalMinutes) {
      throw new MassageError(409, "Thẻ không đủ số giờ còn lại cho lượt sử dụng này.");
    }
    const sameCard = old && old.cardId === cardId && cardId !== null;
    const serviceType = sameService ? old.serviceType : service?.name;
    if (!serviceType) throw new MassageError(400, "Hãy chọn loại hình dịch vụ.");
    const values = {
      memberId: member.id, employeeName: sameEmployee ? old.employeeName : member.name,
      cardId, customerName: sameCard ? old.customerName : card?.customerName ?? input.customerName?.trim() ?? "",
      serviceType, serviceTypeId, workDate: input.workDate, minutes: input.minutes,
      customerHourlyRate: customerRate ?? 0,
      customerCharge: Math.round(input.minutes * (customerRate ?? 0) / 60),
      hourlyRate: rate,
      earnings: Math.round(input.minutes * rate / 60), note: input.note?.trim() ?? "",
    };
    const [row] = id
      ? await tx.update(serviceSessionsTable).set(values).where(eq(serviceSessionsTable.id, id)).returning()
      : await tx.insert(serviceSessionsTable).values(values).returning();
    if (card && !card.firstUsedAt) {
      await tx.update(treatmentCardsTable).set({ firstUsedAt: sql`clock_timestamp()` })
        .where(eq(treatmentCardsTable.id, card.id));
    }
    return sessionResponse(row);
  });
}
export async function deleteSession(id: number) {
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, id)).for("update");
    if (!old) throw new MassageError(404, "Không tìm thấy lượt phục vụ.");
    if (old.cardId !== null) await tx.select().from(treatmentCardsTable)
      .where(eq(treatmentCardsTable.id, old.cardId)).for("update");
    await tx.delete(serviceSessionsTable).where(eq(serviceSessionsTable.id, id));
  });
}
