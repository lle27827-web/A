import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { appointmentsTable, attendanceTable, cardTopUpsTable, cardUsageHistoryTable, db, membersTable, memberVersionsTable, serviceSessionsTable, treatmentCardsTable, serviceTypesTable, type CardTopUpRow } from "@workspace/db";
import type { FacilityPermissions, ServiceSessionInput, TreatmentCardInput, TreatmentCardUpdate } from "@workspace/api-zod";
import { canEditEmployee } from "./facility-permissions";
import { isWithinRetention, retentionCutoffDate } from "./retention-window";

export class MassageError extends Error {
  constructor(public status: number, message: string, public details?: { mergeTargetId: number }) { super(message); }
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

export function retainedDate(value: string) {
  const date = validDate(value);
  if (!isWithinRetention(date)) throw new MassageError(400, "Chỉ xem và ghi lịch sử trong 5 năm gần nhất.");
  return date;
}

export function retainedMonthBounds(month: string) {
  const bounds = monthBounds(month);
  const cutoff = retentionCutoffDate();
  if (bounds.end <= cutoff) throw new MassageError(400, "Chỉ xem lịch sử trong 5 năm gần nhất.");
  return { ...bounds, start: bounds.start < cutoff ? cutoff : bounds.start };
}

export function sessionResponse(row: typeof serviceSessionsTable.$inferSelect) {
  return { ...row, archived: false, createdAt: row.createdAt.toISOString() };
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
function sameAppointmentCustomer(appointment: typeof appointmentsTable.$inferSelect, card: typeof treatmentCardsTable.$inferSelect) {
  return identityText(appointment.customerName) === identityText(card.customerName)
    || identityPhone(appointment.phone) === identityPhone(card.phone);
}

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
  const [live] = await tx.select({ used: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}), 0)` })
    .from(serviceSessionsTable)
    .where(and(eq(serviceSessionsTable.cardId, cardId), excludeId ? ne(serviceSessionsTable.id, excludeId) : undefined));
  const [archived] = await tx.select({ used: sql<number>`coalesce(sum(${cardUsageHistoryTable.minutes}), 0)` })
    .from(cardUsageHistoryTable).where(eq(cardUsageHistoryTable.cardId, cardId));
  return Number(live.used) + Number(archived.used);
}
function cardValues(input: TreatmentCardInput) {
  validDate(input.purchaseDate);
  const customerName = input.customerName.trim();
  const serviceType = input.serviceType.trim();
  const phone = input.phone.trim();
  if (!customerName || !serviceType || !phone) throw new MassageError(400, "Cần tên khách, số điện thoại và loại dịch vụ.");
  const { mergeTargetId: _confirmation, ...data } = input;
  return { ...data, customerName, serviceType, phone, note: input.note?.trim() ?? "" };
}
export async function createCard(input: TreatmentCardInput) {
  const values = cardValues(input);
  return db.transaction(async (tx) => {
    // Shared by creation and edits: changing identity cannot race a concurrent sale.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('so-cong:card-identities', 0))`);
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
      if (input.mergeTargetId !== existing.id) throw new MassageError(409, "Thẻ đã có. Xác nhận cộng vào thẻ hiện có?", { mergeTargetId: existing.id });
      return { ...await creditCard(tx, existing, values.totalMinutes, values.purchaseAmount, values.purchaseDate,
        "merged_sale", values.note), mergedIntoExisting: true };
    }
    if (input.mergeTargetId) throw new MassageError(409, "Thẻ cần gộp đã thay đổi. Hãy kiểm tra thông tin và lưu lại.");
    const [row] = await tx.insert(treatmentCardsTable).values(values).returning();
    return { ...cardResponse(row), mergedIntoExisting: false };
  });
}
export async function updateCard(id: number, input: TreatmentCardUpdate) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('so-cong:card-identities', 0))`);
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
    const identity = [identityText(values.customerName), identityPhone(values.phone), identityText(values.serviceType)];
    const matches = await tx.select().from(treatmentCardsTable).where(and(ne(treatmentCardsTable.id, id),
      isNull(treatmentCardsTable.deletedAt),
      sql`lower(normalize(regexp_replace(btrim(${treatmentCardsTable.customerName}), '[[:space:]]+', ' ', 'g'), NFC)) = ${identity[0]}`,
      sql`lower(normalize(regexp_replace(btrim(${treatmentCardsTable.serviceType}), '[[:space:]]+', ' ', 'g'), NFC)) = ${identity[2]}`,
    )).orderBy(asc(treatmentCardsTable.id)).for("update");
    const target = matches.find((card) => identityPhone(card.phone) === identity[1]);
    if (target) {
      if (input.mergeTargetId !== target.id) throw new MassageError(409, "Thẻ đã có. Xác nhận cộng giờ, tiền và lịch sử vào thẻ hiện có?", { mergeTargetId: target.id });
      const totalMinutes = target.totalMinutes + values.totalMinutes;
      if (totalMinutes > 600000) throw new MassageError(400, "Tổng giờ sau khi gộp không được vượt quá 10.000 giờ.");
      // Preserve every receipt's original business date. Moving the old initial sale
      // into the payment ledger avoids counting the sale twice or booking it today.
      await tx.insert(cardTopUpsTable).values({ cardId: target.id,
        minutes: values.totalMinutes - Number(topUpTotal.minutes), amount: values.purchaseAmount,
        paymentDate: values.purchaseDate, source: "merged_card",
        note: `Gộp thẻ #${old.id}${values.note ? ` · ${values.note}` : ""}` });
      await tx.update(cardTopUpsTable).set({ cardId: target.id }).where(eq(cardTopUpsTable.cardId, id));
      await tx.update(serviceSessionsTable).set({ cardId: target.id }).where(eq(serviceSessionsTable.cardId, id));
      await tx.update(cardUsageHistoryTable).set({ cardId: target.id }).where(eq(cardUsageHistoryTable.cardId, id));
      const firstUsedAt = [target.firstUsedAt, old.firstUsedAt].filter((v): v is Date => Boolean(v))
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? (used > 0 ? new Date() : null);
      const [merged] = await tx.update(treatmentCardsTable).set({ totalMinutes, firstUsedAt })
        .where(eq(treatmentCardsTable.id, target.id)).returning();
      await tx.update(treatmentCardsTable).set({ deletedAt: new Date() }).where(eq(treatmentCardsTable.id, id));
      return { ...await cardWithHistory(tx, merged, await usedMinutes(tx, target.id)), mergedIntoExisting: true };
    }
    if (input.mergeTargetId) throw new MassageError(409, "Thẻ cần gộp đã thay đổi. Hãy kiểm tra thông tin và lưu lại.");
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
    const used = await usedMinutes(tx, id);
    const remaining = card.totalMinutes - used;
    if (remaining > 0) {
      const latestFundingAt = sql`GREATEST(
        ${card.createdAt}::timestamptz,
        COALESCE(
          (SELECT max(${cardTopUpsTable.createdAt}) FROM ${cardTopUpsTable}
            WHERE ${cardTopUpsTable.cardId} = ${id}),
          ${card.createdAt}::timestamptz
        )
      )`;
      const [useSinceLatestFunding] = await tx.select({
        found: sql<boolean>`(
          (${card.firstUsedAt} IS NOT NULL AND ${card.firstUsedAt} >= ${latestFundingAt})
          OR EXISTS (
            SELECT 1 FROM ${serviceSessionsTable} AS card_sessions
            WHERE card_sessions.card_id = ${id}
              AND card_sessions.created_at >= ${latestFundingAt}
          )
          OR EXISTS (
            SELECT 1 FROM ${cardUsageHistoryTable} AS archived_uses
            WHERE archived_uses.card_id = ${id}
              AND archived_uses.created_at >= ${latestFundingAt}
          )
        )`,
      }).from(treatmentCardsTable).where(eq(treatmentCardsTable.id, id));
      if (useSinceLatestFunding.found) {
        throw new MassageError(
          409,
          "Thẻ còn giờ và đã có lượt dùng sau lần mua hoặc nạp gần nhất. Chỉ xóa khi đã dùng hết giờ hoặc chưa dùng từ lần mua/nạp gần nhất.",
        );
      }
    }
    // Keep the card, payments, and every employee visit as audit history.
    // Active card lists and card-sale revenue exclude this archived card.
    await tx.update(treatmentCardsTable).set({ deletedAt: new Date() }).where(eq(treatmentCardsTable.id, id));
  });
}

export async function deleteMember(id: number) {
  await db.transaction(async (tx) => {
    // Follow saveSession's session-before-member lock order to avoid deadlocks
    // with an edit already holding a visit row.
    await tx.select({ id: serviceSessionsTable.id }).from(serviceSessionsTable)
      .where(eq(serviceSessionsTable.memberId, id)).orderBy(asc(serviceSessionsTable.id)).for("update");
    const [member] = await tx.select({ id: membersTable.id }).from(membersTable)
      .where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt))).for("update");
    if (!member) throw new MassageError(404, "Không tìm thấy nhân viên.");
    // Scope deletion to the current business month. Earlier months are immutable
    // history, including card usage, walk-in revenue, attendance and payroll.
    const currentMonthStart = `${currentBusinessDate().slice(0, 7)}-01`;
    // Keep current-month customer card-use history and its consumed minutes, but
    // detach the deleted employee and remove current-month wage associations.
    await tx.update(serviceSessionsTable).set({
      memberId: null,
      hourlyRate: 0,
      earnings: 0,
    }).where(and(
      eq(serviceSessionsTable.memberId, id),
      isNotNull(serviceSessionsTable.cardId),
      gte(serviceSessionsTable.workDate, currentMonthStart),
    ));
    // Remove only current-month walk-in sessions, preserving prior-month revenue.
    await tx.delete(serviceSessionsTable).where(and(
      eq(serviceSessionsTable.memberId, id),
      isNull(serviceSessionsTable.cardId),
      gte(serviceSessionsTable.workDate, currentMonthStart),
    ));
    await tx.delete(attendanceTable).where(and(
      eq(attendanceTable.memberId, id),
      gte(attendanceTable.workDate, currentMonthStart),
    ));
    // Soft delete the profile so prior-month names, pay rates and visit details
    // remain available in historical views. No card totals or visit minutes change.
    await tx.update(membersTable).set({ deletedAt: new Date() })
      .where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt)));
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
export async function saveSession(input: ServiceSessionInput, id?: number, permissions?: FacilityPermissions) {
  const workDate = validDate(input.workDate);
  if (input.cardId == null && !isWithinRetention(workDate)) {
    throw new MassageError(400, "Chỉ ghi ca khách lẻ trong 5 năm gần nhất.");
  }
  return db.transaction(async (tx) => {
    const [old] = id ? await tx.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, id)).for("update") : [];
    if (id && !old) throw new MassageError(404, "Không tìm thấy lượt phục vụ.");
    const cardId = input.cardId ?? null;
    if (permissions && (!canEditEmployee(permissions, input.memberId)
      || (old && !canEditEmployee(permissions, old.memberId ?? 0))
      || ((old?.cardId != null || cardId !== null) && !(permissions.viewCards && permissions.editCards)))) {
      throw new MassageError(403, "Bạn chưa được cấp quyền sửa ca này.");
    }
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
    if (card) {
      const sameDayAppointments = await tx.select().from(appointmentsTable).where(and(
        eq(appointmentsTable.status, "scheduled"),
        sql`to_char(${appointmentsTable.scheduledAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') = ${input.workDate}`,
      )).for("update");
      const matchedIds = sameDayAppointments.filter((appointment) => sameAppointmentCustomer(appointment, card)).map(({ id }) => id);
      if (matchedIds.length) {
        await tx.update(appointmentsTable).set({ status: "completed", updatedAt: new Date() })
          .where(inArray(appointmentsTable.id, matchedIds));
      }
    }
    return sessionResponse(row);
  });
}
export async function deleteSession(id: number, permissions?: FacilityPermissions) {
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, id)).for("update");
    if (old && permissions && (!(old.memberId === null ? permissions.allEmployees && permissions.editEmployees : canEditEmployee(permissions, old.memberId))
      || (old.cardId !== null && !(permissions.viewCards && permissions.editCards)))) {
      throw new MassageError(403, "Bạn chưa được cấp quyền xóa ca này.");
    }
    if (!old) throw new MassageError(404, "Không tìm thấy lượt phục vụ.");
    if (old.cardId !== null) await tx.select().from(treatmentCardsTable)
      .where(eq(treatmentCardsTable.id, old.cardId)).for("update");
    await tx.delete(serviceSessionsTable).where(eq(serviceSessionsTable.id, id));
  });
}
