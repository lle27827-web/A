import { and, eq, ne, sql } from "drizzle-orm";
import { db, membersTable, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
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
export function cardResponse(row: typeof treatmentCardsTable.$inferSelect, usedMinutes = 0, owner = false) {
  return {
    ...row,
    phone: owner ? row.phone : `•••• ${row.phone.slice(-4)}`,
    usedMinutes,
    remainingMinutes: row.totalMinutes - usedMinutes,
    createdAt: row.createdAt.toISOString(),
  };
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
  const [row] = await db.insert(treatmentCardsTable).values(cardValues(input)).returning();
  return cardResponse(row, 0, true);
}
export async function updateCard(id: number, input: TreatmentCardUpdate) {
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, id)).for("update");
    if (!old) throw new MassageError(404, "Không tìm thấy thẻ.");
    const used = await usedMinutes(tx, id);
    const values = cardValues({ ...old, ...input });
    if (values.totalMinutes < used) throw new MassageError(409, "Tổng giờ của thẻ không thể thấp hơn số giờ đã sử dụng.");
    const [row] = await tx.update(treatmentCardsTable).set({
      customerName: values.customerName, phone: values.phone, serviceType: values.serviceType,
      totalMinutes: values.totalMinutes, purchaseAmount: values.purchaseAmount,
      purchaseDate: values.purchaseDate, note: values.note,
    }).where(eq(treatmentCardsTable.id, id)).returning();
    return cardResponse(row, used, true);
  });
}
export async function deleteCard(id: number) {
  await db.transaction(async (tx) => {
    const [card] = await tx.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, id)).for("update");
    if (!card) throw new MassageError(404, "Không tìm thấy thẻ.");
    const [usage] = await tx.select({ id: serviceSessionsTable.id }).from(serviceSessionsTable)
      .where(eq(serviceSessionsTable.cardId, id)).limit(1);
    if (usage) throw new MassageError(409, "Thẻ đã có lịch sử sử dụng. Không thể xóa thẻ khi còn các lượt sử dụng.");
    await tx.delete(treatmentCardsTable).where(eq(treatmentCardsTable.id, id));
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
    const [member] = await tx.select().from(membersTable).where(eq(membersTable.id, input.memberId));
    if (!member) throw new MassageError(404, "Không tìm thấy kỹ thuật viên.");
    const sameEmployee = old?.memberId === member.id;
    const rate = sameEmployee ? old.hourlyRate : member.hourlyRate;
    if (rate <= 0) throw new MassageError(400, "Hãy thiết lập mức lương mỗi giờ cho kỹ thuật viên trước khi ghi lượt phục vụ.");
    if (card && await usedMinutes(tx, card.id, id) + input.minutes > card.totalMinutes) {
      throw new MassageError(409, "Thẻ không đủ số giờ còn lại cho lượt sử dụng này.");
    }
    const sameCard = old && old.cardId === cardId && cardId !== null;
    const serviceType = sameCard ? old.serviceType : card?.serviceType ?? input.serviceType?.trim();
    if (!serviceType) throw new MassageError(400, "Cần nhập loại dịch vụ khi không sử dụng thẻ.");
    const values = {
      memberId: member.id, employeeName: sameEmployee ? old.employeeName : member.name,
      cardId, customerName: sameCard ? old.customerName : card?.customerName ?? input.customerName?.trim() ?? "",
      serviceType, workDate: input.workDate, minutes: input.minutes, hourlyRate: rate,
      earnings: Math.round(input.minutes * rate / 60), note: input.note?.trim() ?? "",
    };
    const [row] = id
      ? await tx.update(serviceSessionsTable).set(values).where(eq(serviceSessionsTable.id, id)).returning()
      : await tx.insert(serviceSessionsTable).values(values).returning();
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
