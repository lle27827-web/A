import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  appendReservedPartitionOperation,
  appointmentsTable,
  apiWriteOperationsTable,
  attendanceTable,
  cardTopUpsTable,
  cardUsageHistoryTable,
  db,
  getReservedPartitionOperation,
  hashPartitionRequest,
  isPartitionedStorageEnabled,
  membersTable,
  memberVersionsTable,
  type MutationDraft,
  partitionEntityKey,
  readPartitionedTable,
  readPartitionedRowById,
  reconcilePartitionOperation,
  reservePartitionOperation,
  serviceSessionsTable,
  serviceTypesTable,
  treatmentCardsTable,
  withPartitionWriteMutex,
  type CardTopUpRow,
} from "@workspace/db";
import type { FacilityPermissions, ServiceSessionInput, TreatmentCardInput, TreatmentCardUpdate } from "@workspace/api-zod";
import { canEditEmployee } from "./facility-permissions";
import { isWithinRetention, retentionCutoffDate } from "./retention-window";
import { commitPartitionedMutations, deleteMutation, operationIdFromRequest, upsertMutation } from "./partitioned-mutations";

export class MassageError extends Error {
  constructor(public status: number, message: string, public details?: { mergeTargetId: number }) { super(message); }
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function idempotentTransaction<T>(
  operationId: string | undefined,
  label: string,
  action: string,
  request: unknown,
  callback: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!operationId) return db.transaction(callback);
  const key = operationIdFromRequest(operationId, label);
  const requestHash = hashPartitionRequest({ action, request });
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(apiWriteOperationsTable).values({
      operationId: key,
      requestHash,
      result: { value: null },
    }).onConflictDoNothing().returning({ operationId: apiWriteOperationsTable.operationId });
    const [record] = await tx.select().from(apiWriteOperationsTable)
      .where(eq(apiWriteOperationsTable.operationId, key)).for("update");
    if (!record) throw new MassageError(503, "Không lưu được trạng thái chống ghi trùng.");
    if (record.requestHash !== requestHash) {
      throw new MassageError(409, "Mã yêu cầu đã được dùng cho nội dung khác. Hãy tải lại và thử lại.");
    }
    if (!inserted) return record.result.value as T;

    const result = await callback(tx);
    await tx.update(apiWriteOperationsTable).set({
      result: { value: result === undefined ? null : result },
    }).where(eq(apiWriteOperationsTable.operationId, key));
    return result;
  });
}

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
const validIdentityPhone = (value: string) => {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0084") && digits.length === 13) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("84") && digits.length === 11) digits = `0${digits.slice(2)}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
};
export function sameAppointmentCustomer(
  appointment: Pick<typeof appointmentsTable.$inferSelect, "customerName" | "phone">,
  card: Pick<typeof treatmentCardsTable.$inferSelect, "customerName" | "phone">,
) {
  const appointmentPhone = validIdentityPhone(appointment.phone);
  const cardPhone = validIdentityPhone(card.phone);
  if (appointmentPhone && cardPhone) return appointmentPhone === cardPhone;
  if (!appointmentPhone && !cardPhone) {
    return identityText(appointment.customerName) === identityText(card.customerName);
  }
  return false;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
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
export async function createCard(input: TreatmentCardInput, operationId?: string) {
  const values = cardValues(input);
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi bán thẻ.");
    return createPartitionedCard(input, values, operationId);
  }
  return idempotentTransaction(operationId, "bán thẻ", "card.create", input, async (tx) => {
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

async function createPartitionedCard(input: TreatmentCardInput, values: Omit<TreatmentCardInput, "mergeTargetId">, operationId: string) {
  return withPartitionWriteMutex("card-identities", async () => {
    const requestHash = hashPartitionRequest({ action: "card.create", input });
    const [cardRowsRaw, topUpRowsRaw, sessionRowsRaw, archivedRowsRaw] = await Promise.all([
      readPartitionedTable("treatment_cards"),
      readPartitionedTable("card_top_ups"),
      readPartitionedTable("service_sessions"),
      readPartitionedTable("card_usage_history"),
    ]);
    const cards = cardRowsRaw as unknown as (typeof treatmentCardsTable.$inferSelect)[];
    const topUps = topUpRowsRaw as unknown as CardTopUpRow[];
    const sessions = sessionRowsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[];
    const archived = archivedRowsRaw as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
    const prior = await getReservedPartitionOperation(operationId, requestHash);
    if (prior) {
      const reconciled = await reconcilePartitionOperation(prior);
      if (reconciled.state === "committed") {
        const merged = !reconciled.allocatedIds.treatment_cards?.length;
        const cardId = merged ? input.mergeTargetId : reconciled.allocatedIds.treatment_cards?.[0];
        const savedCard = cards.find((card) => card.id === cardId);
        if (!savedCard) throw new MassageError(503, "Không tải lại được thẻ sau khi lưu.");
        const used = sessions.filter((session) => session.cardId === cardId).reduce((sum, row) => sum + row.minutes, 0)
          + archived.filter((row) => row.cardId === cardId).reduce((sum, row) => sum + row.minutes, 0);
        return { ...cardResponse(savedCard, used, topUps.filter((row) => row.cardId === cardId)), mergedIntoExisting: merged };
      }
    }
    if (!Number.isSafeInteger(values.totalMinutes) || values.totalMinutes < 1 || values.totalMinutes > 600000 ||
        !Number.isSafeInteger(values.purchaseAmount) || values.purchaseAmount < 0 || values.purchaseAmount > 1_000_000_000) {
      throw new MassageError(400, "Số giờ hoặc số tiền nạp không hợp lệ.");
    }
    const identity = [
      identityText(values.customerName),
      identityPhone(values.phone),
      identityText(values.serviceType),
    ];
    const candidates = cards.filter((card) =>
      card.deletedAt === null &&
      identityText(card.customerName) === identity[0] &&
      identityText(card.serviceType) === identity[2],
    ).sort((a, b) => a.id - b.id);
    const existing = candidates.find((card) => identityPhone(card.phone) === identity[1]);
    if (existing && input.mergeTargetId !== existing.id) {
      throw new MassageError(409, "Thẻ đã có. Xác nhận cộng vào thẻ hiện có?", { mergeTargetId: existing.id });
    }
    if (!existing && input.mergeTargetId) {
      throw new MassageError(409, "Thẻ cần gộp đã thay đổi. Hãy kiểm tra thông tin và lưu lại.");
    }
    if (existing && existing.totalMinutes + values.totalMinutes > 600000) {
      throw new MassageError(400, "Tổng số giờ của thẻ không được vượt quá 10.000 giờ.");
    }
    const isMerge = Boolean(existing);
    const operation = await reservePartitionOperation({
      operationId,
      requestHash,
      expectedEventCount: isMerge ? 2 : 1,
      idAllocations: isMerge
        ? { card_top_ups: 1 }
        : { treatment_cards: 1 },
    });
    const reconciled = await reconcilePartitionOperation(operation);
    if (reconciled.state !== "committed") {
      const mutations: MutationDraft[] = [];
      let cardId: number;
      if (existing) {
        cardId = existing.id;
        const topUpId = reconciled.allocatedIds.card_top_ups?.[0];
        if (!topUpId) throw new MassageError(503, "Không cấp được mã giao dịch bán thẻ.");
        mutations.push({
          entityType: "treatment_cards",
          entityKey: partitionEntityKey("treatment_cards", existing.id),
          action: "upsert",
          payload: { ...existing, totalMinutes: existing.totalMinutes + values.totalMinutes },
        });
        mutations.push({
          entityType: "card_top_ups",
          entityKey: partitionEntityKey("card_top_ups", topUpId),
          action: "upsert",
          payload: {
            id: topUpId,
            cardId: existing.id,
            minutes: values.totalMinutes,
            amount: values.purchaseAmount,
            paymentDate: values.purchaseDate,
            source: "merged_sale",
            note: values.note,
            createdAt: new Date(),
          },
        });
      } else {
        cardId = reconciled.allocatedIds.treatment_cards?.[0] ?? 0;
        if (!cardId) throw new MassageError(503, "Không cấp được mã thẻ.");
        mutations.push({
          entityType: "treatment_cards",
          entityKey: partitionEntityKey("treatment_cards", cardId),
          action: "upsert",
          payload: {
            ...values,
            id: cardId,
            firstUsedAt: null,
            deletedAt: null,
            createdAt: new Date(),
          },
        });
      }
      await appendReservedPartitionOperation(reconciled, mutations);
      const resultCard = existing
        ? { ...existing, totalMinutes: existing.totalMinutes + values.totalMinutes }
        : {
            ...values,
            id: cardId,
            firstUsedAt: null,
            deletedAt: null,
            createdAt: new Date(),
          } as typeof treatmentCardsTable.$inferSelect;
      return {
        ...cardResponse(
          resultCard,
          sessions.filter((session) => session.cardId === cardId).reduce((sum, row) => sum + row.minutes, 0)
            + archived.filter((row) => row.cardId === cardId).reduce((sum, row) => sum + row.minutes, 0),
          existing
            ? [
                ...topUps.filter((row) => row.cardId === cardId),
                {
                  id: reconciled.allocatedIds.card_top_ups?.[0] ?? 0,
                  cardId,
                  minutes: values.totalMinutes,
                  amount: values.purchaseAmount,
                  paymentDate: values.purchaseDate,
                  source: "merged_sale",
                  note: values.note,
                  createdAt: new Date(),
                } as CardTopUpRow,
              ]
            : [],
        ),
        mergedIntoExisting: isMerge,
      };
    }
    throw new MassageError(503, "Không xác định được kết quả lưu thẻ.");
  });
}
export async function updateCard(id: number, input: TreatmentCardUpdate, operationId?: string) {
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi sửa thẻ.");
    return withPartitionWriteMutex("card-identities", () =>
      withPartitionWriteMutex("card-ledger", async () => {
        const [cardsRaw, topUpsRaw, sessionsRaw, archivedRaw] = await Promise.all([
          readPartitionedTable("treatment_cards"),
          readPartitionedTable("card_top_ups"),
          readPartitionedTable("service_sessions"),
          readPartitionedTable("card_usage_history"),
        ]);
        const cards = cardsRaw as unknown as (typeof treatmentCardsTable.$inferSelect)[];
        const topUps = topUpsRaw as unknown as CardTopUpRow[];
        const sessions = sessionsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[];
        const archived = archivedRaw as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
        const old = cards.find((row) => row.id === id && row.deletedAt === null);
        if (!old) throw new MassageError(404, "Không tìm thấy thẻ.");
        const used = sessions.filter((row) => row.cardId === id).reduce((sum, row) => sum + row.minutes, 0) +
          archived.filter((row) => row.cardId === id).reduce((sum, row) => sum + row.minutes, 0);
        const values = cardValues({ ...old, ...input });
        if (values.totalMinutes < used) throw new MassageError(409, "Tổng giờ của thẻ không thể thấp hơn số giờ đã sử dụng.");
        const oldTopUps = topUps.filter((row) => row.cardId === id);
        const topUpMinutes = oldTopUps.reduce((sum, row) => sum + row.minutes, 0);
        if (values.totalMinutes < topUpMinutes) {
          throw new MassageError(409, "Tổng giờ không thể thấp hơn số giờ đã nạp trong lịch sử.");
        }
        const identity = [identityText(values.customerName), identityPhone(values.phone), identityText(values.serviceType)];
        const target = cards.filter((row) => row.id !== id && row.deletedAt === null)
          .sort((a, b) => a.id - b.id)
          .find((row) =>
            identityText(row.customerName) === identity[0] &&
            identityPhone(row.phone) === identity[1] &&
            identityText(row.serviceType) === identity[2],
          );
        if (target && input.mergeTargetId !== target.id) {
          throw new MassageError(409, "Thẻ đã có. Xác nhận cộng giờ, tiền và lịch sử vào thẻ hiện có?", { mergeTargetId: target.id });
        }
        if (!target && input.mergeTargetId) throw new MassageError(409, "Thẻ cần gộp đã thay đổi. Hãy kiểm tra thông tin và lưu lại.");

        const now = new Date();
        if (!target) {
          const updated = {
            ...old,
            customerName: values.customerName,
            phone: values.phone,
            serviceType: values.serviceType,
            totalMinutes: values.totalMinutes,
            purchaseAmount: values.purchaseAmount,
            purchaseDate: values.purchaseDate,
            note: values.note,
          };
          await commitPartitionedMutations({
            operationId,
            lockName: `card:${id}`,
            action: "card.update",
            request: { id, input },
            expectedEventCount: 1,
            alreadyLocked: true,
            build: () => [upsertMutation("treatment_cards", id, updated)],
          });
          const refreshed = (await readPartitionedTable("treatment_cards") as unknown as (typeof treatmentCardsTable.$inferSelect)[])
            .find((row) => row.id === id);
          if (!refreshed) throw new MassageError(503, "Không tải lại được thẻ sau khi sửa.");
          return cardResponse(refreshed, used, topUps.filter((row) => row.cardId === id));
        }
        if (target.totalMinutes + values.totalMinutes > 600000) {
          throw new MassageError(400, "Tổng số giờ sau khi gộp không được vượt quá 10.000 giờ.");
        }
        const oldSessions = sessions.filter((row) => row.cardId === id);
        const oldArchived = archived.filter((row) => row.cardId === id);
        const oldFundingMinutes = values.totalMinutes - topUpMinutes;
        const firstUsedAt = [target.firstUsedAt, old.firstUsedAt].filter((value): value is Date => Boolean(value))
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? (used > 0 ? now : null);
        const eventCount = 3 + oldTopUps.length + oldSessions.length + oldArchived.length;
        const operation = await commitPartitionedMutations({
          operationId,
          lockName: `card:${id}`,
          action: "card.merge",
          request: { id, input },
          expectedEventCount: eventCount,
          idAllocations: { card_top_ups: 1 },
          alreadyLocked: true,
          build: (reserved) => {
            const topUpId = reserved.allocatedIds.card_top_ups?.[0];
            if (!topUpId) throw new MassageError(503, "Không cấp được mã giao dịch gộp thẻ.");
            return [
              upsertMutation("treatment_cards", target.id, {
                ...target,
                totalMinutes: target.totalMinutes + values.totalMinutes,
                firstUsedAt,
              }),
              upsertMutation("treatment_cards", old.id, { ...old, deletedAt: now }),
              upsertMutation("card_top_ups", topUpId, {
                id: topUpId,
                cardId: target.id,
                minutes: oldFundingMinutes,
                amount: values.purchaseAmount,
                paymentDate: values.purchaseDate,
                source: "merged_card",
                note: `Gộp thẻ #${old.id}${values.note ? ` · ${values.note}` : ""}`,
                createdAt: now,
              }),
              ...oldTopUps.map((row) => upsertMutation("card_top_ups", row.id, { ...row, cardId: target.id })),
              ...oldSessions.map((row) => upsertMutation("service_sessions", row.id, { ...row, cardId: target.id })),
              ...oldArchived.map((row) => upsertMutation("card_usage_history", row.sourceSessionId, { ...row, cardId: target.id })),
            ];
          },
        });
        const targetCard = (await readPartitionedTable("treatment_cards") as unknown as (typeof treatmentCardsTable.$inferSelect)[])
          .find((row) => row.id === target.id);
        if (!targetCard) throw new MassageError(503, "Không tải lại được thẻ sau khi gộp.");
        const refreshedTopUps = await readPartitionedTable("card_top_ups") as unknown as CardTopUpRow[];
        const refreshedSessions = await readPartitionedTable("service_sessions") as unknown as (typeof serviceSessionsTable.$inferSelect)[];
        const refreshedArchived = await readPartitionedTable("card_usage_history") as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
        const targetUsed = refreshedSessions.filter((row) => row.cardId === target.id).reduce((sum, row) => sum + row.minutes, 0) +
          refreshedArchived.filter((row) => row.cardId === target.id).reduce((sum, row) => sum + row.minutes, 0);
        return {
          ...cardResponse(targetCard, targetUsed, refreshedTopUps.filter((row) => row.cardId === target.id)),
          mergedIntoExisting: true,
        };
      }),
    );
  }
  return idempotentTransaction(operationId, "sửa thẻ", "card.update", { id, input }, async (tx) => {
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
export async function deleteCard(id: number, operationId?: string) {
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi xóa thẻ.");
    return withPartitionWriteMutex("card-identities", () =>
      withPartitionWriteMutex("card-ledger", async () => {
        const cardsRaw = await readPartitionedTable("treatment_cards");
        const cards = cardsRaw as unknown as (typeof treatmentCardsTable.$inferSelect)[];
        const card = cards.find((row) => row.id === id && row.deletedAt === null);
        if (!card) throw new MassageError(404, "Không tìm thấy thẻ.");
        await commitPartitionedMutations({
          operationId,
          lockName: `card:${id}`,
          action: "card.delete",
          request: { id },
          expectedEventCount: 1,
          alreadyLocked: true,
          build: () => [upsertMutation("treatment_cards", id, { ...card, deletedAt: new Date() })],
        });
      }),
    );
  }
  await idempotentTransaction(operationId, "xóa thẻ", "card.delete", { id }, async (tx) => {
    const [card] = await tx.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, id)).for("update");
    if (!card || card.deletedAt) throw new MassageError(404, "Không tìm thấy thẻ.");
    // Keep the card, payments, and every employee visit as audit history.
    // Active card lists and card-sale revenue exclude this archived card.
    await tx.update(treatmentCardsTable).set({ deletedAt: new Date() }).where(eq(treatmentCardsTable.id, id));
  });
}

export async function deleteMember(id: number, operationId?: string) {
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi xóa nhân viên.");
    await withPartitionWriteMutex(`member:${id}`, async () => {
      const [members, sessions, attendance] = await Promise.all([
        readPartitionedTable("members"),
        readPartitionedTable("service_sessions"),
        readPartitionedTable("attendance"),
      ]);
      const member = (members as unknown as (typeof membersTable.$inferSelect)[])
        .find((row) => row.id === id && row.deletedAt === null);
      if (!member) throw new MassageError(404, "Không tìm thấy nhân viên.");
      const currentMonthStart = `${currentBusinessDate().slice(0, 7)}-01`;
      const currentSessions = (sessions as unknown as (typeof serviceSessionsTable.$inferSelect)[])
        .filter((row) => row.memberId === id && row.workDate >= currentMonthStart);
      const currentAttendance = (attendance as unknown as (typeof attendanceTable.$inferSelect)[])
        .filter((row) => row.memberId === id && row.workDate >= currentMonthStart);
      const cardUses = currentSessions.filter((row) => row.cardId !== null);
      const walkIns = currentSessions.filter((row) => row.cardId === null);
      const deletedAt = new Date();
      await commitPartitionedMutations({
        operationId,
        lockName: `member-delete:${id}`,
        action: "member.delete",
        request: { id },
        expectedEventCount: 1 + cardUses.length + walkIns.length + currentAttendance.length,
        alreadyLocked: true,
        build: () => [
          ...cardUses.map((row) => upsertMutation("service_sessions", row.id, {
            ...row, memberId: null, hourlyRate: 0, earnings: 0,
          })),
          ...walkIns.map((row) => deleteMutation("service_sessions", row.id)),
          ...currentAttendance.map((row) => deleteMutation("attendance", row.id)),
          upsertMutation("members", id, { ...member, deletedAt }),
        ],
      });
    });
    return;
  }
  await idempotentTransaction(operationId, "xóa nhân viên", "member.delete", { id }, async (tx) => {
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
export async function addCardHours(id: number, minutes: number, amount: number, operationId?: string) {
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 600000) {
    throw new MassageError(400, "Số giờ nạp phải lớn hơn 0 và không quá 10.000 giờ.");
  }
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng cho giao dịch nạp thẻ.");
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000) {
      throw new MassageError(400, "Số tiền nạp không hợp lệ.");
    }
    return withPartitionWriteMutex("card-ledger", async () => {
      const requestHash = hashPartitionRequest({ action: "card.topup", id, minutes, amount });
      const [cards, topUps, sessions, archived] = await Promise.all([
        readPartitionedTable("treatment_cards"),
        readPartitionedTable("card_top_ups"),
        readPartitionedTable("service_sessions"),
        readPartitionedTable("card_usage_history"),
      ]);
      const cardRows = cards as unknown as (typeof treatmentCardsTable.$inferSelect)[];
      const topUpRows = topUps as unknown as CardTopUpRow[];
      const sessionRows = sessions as unknown as (typeof serviceSessionsTable.$inferSelect)[];
      const archivedRows = archived as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
      const prior = await getReservedPartitionOperation(operationId, requestHash);
      if (prior) {
        const reconciledPrior = await reconcilePartitionOperation(prior);
        if (reconciledPrior.state === "committed") {
          const priorCard = cardRows.find((row) => row.id === id);
          if (!priorCard) throw new MassageError(503, "Không tải lại được thẻ sau khi nạp.");
          const priorUsed = sessionRows.filter((row) => row.cardId === id).reduce((sum, row) => sum + row.minutes, 0)
            + archivedRows.filter((row) => row.cardId === id).reduce((sum, row) => sum + row.minutes, 0);
          return cardResponse(
            priorCard,
            priorUsed,
            topUpRows.filter((row) => row.cardId === id)
              .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.id - a.id),
          );
        }
      }
      const card = cardRows.find((row) => row.id === id && row.deletedAt === null);
      if (!card) throw new MassageError(404, "Không tìm thấy thẻ.");
      if (card.totalMinutes + minutes > 600000) {
        throw new MassageError(400, "Tổng số giờ của thẻ không được vượt quá 10.000 giờ.");
      }
      const operation = await reservePartitionOperation({
        operationId,
        requestHash,
        expectedEventCount: 2,
        idAllocations: { card_top_ups: 1 },
      });
      const reconciled = await reconcilePartitionOperation(operation);
      if (reconciled.state !== "committed") {
        const topUpId = reconciled.allocatedIds.card_top_ups?.[0];
        if (!topUpId) throw new MassageError(503, "Không cấp được mã giao dịch nạp thẻ.");
        const paymentDate = currentBusinessDate();
        const updatedCard = { ...card, totalMinutes: card.totalMinutes + minutes };
        const payment = {
          id: topUpId,
          cardId: id,
          minutes,
          amount,
          paymentDate,
          source: "topup",
          note: "",
          createdAt: new Date(),
        };
        await appendReservedPartitionOperation(reconciled, [
          {
            entityType: "treatment_cards",
            entityKey: partitionEntityKey("treatment_cards", id),
            action: "upsert",
            payload: { ...updatedCard },
          },
          {
            entityType: "card_top_ups",
            entityKey: partitionEntityKey("card_top_ups", topUpId),
            action: "upsert",
            payload: payment,
          },
        ]);
      }
      const refreshedCards = await readPartitionedTable("treatment_cards") as unknown as (typeof treatmentCardsTable.$inferSelect)[];
      const refreshedCard = refreshedCards.find((row) => row.id === id);
      if (!refreshedCard) throw new MassageError(503, "Không tải lại được thẻ sau khi nạp.");
      const refreshedTopUps = await readPartitionedTable("card_top_ups") as unknown as CardTopUpRow[];
      const usedLive = await readPartitionedTable("service_sessions") as unknown as (typeof serviceSessionsTable.$inferSelect)[];
      const usedArchived = await readPartitionedTable("card_usage_history") as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
      const used = usedLive.filter((row) => row.cardId === id).reduce((sum, row) => sum + row.minutes, 0)
        + usedArchived.filter((row) => row.cardId === id).reduce((sum, row) => sum + row.minutes, 0);
      return cardResponse(
        refreshedCard,
        used,
        refreshedTopUps.filter((row) => row.cardId === id)
          .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.id - a.id),
      );
    });
  }
  return idempotentTransaction(operationId, "nạp thẻ", "card.topup", { id, minutes, amount }, async (tx) => {
    const [card] = await tx.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, id)).for("update");
    if (!card || card.deletedAt) throw new MassageError(404, "Không tìm thấy thẻ.");
    return creditCard(tx, card, minutes, amount, currentBusinessDate(), "topup");
  });
}

// Lock the session and affected cards in a consistent order. Card row locks
// serialize balance checks so simultaneous requests cannot overspend hours.
export async function saveSession(
  input: ServiceSessionInput,
  id?: number,
  permissions?: FacilityPermissions,
  operationId?: string,
) {
  const workDate = validDate(input.workDate);
  if (input.cardId == null && !isWithinRetention(workDate)) {
    throw new MassageError(400, "Chỉ ghi ca khách lẻ trong 5 năm gần nhất.");
  }
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng cho ca chấm công.");
    return savePartitionedSession(input, id, permissions, operationId);
  }
  return idempotentTransaction(operationId, id === undefined ? "chấm công" : "sửa ca", "service-session.save", {
    id: id ?? null, input,
  }, async (tx) => {
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

async function savePartitionedSession(
  input: ServiceSessionInput,
  id: number | undefined,
  permissions: FacilityPermissions | undefined,
  operationId: string,
) {
  return withPartitionWriteMutex("card-ledger", async () => {
    const requestHash = hashPartitionRequest({ action: "service-session.save", id: id ?? null, input });
    const [sessionRowsRaw, cardRowsRaw, archivedRowsRaw, memberRowsRaw, serviceRowsRaw, appointmentRowsRaw] =
      await Promise.all([
        readPartitionedTable("service_sessions"),
        readPartitionedTable("treatment_cards"),
        readPartitionedTable("card_usage_history"),
        readPartitionedTable("members"),
        readPartitionedTable("service_types"),
        readPartitionedTable("appointments"),
      ]);
    const sessionRows = sessionRowsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[];
    const cardRows = cardRowsRaw as unknown as (typeof treatmentCardsTable.$inferSelect)[];
    const archivedRows = archivedRowsRaw as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
    const memberRows = memberRowsRaw as unknown as (typeof membersTable.$inferSelect)[];
    const serviceRows = serviceRowsRaw as unknown as (typeof serviceTypesTable.$inferSelect)[];
    const appointmentRows = appointmentRowsRaw as unknown as (typeof appointmentsTable.$inferSelect)[];
    const prior = await getReservedPartitionOperation(operationId, requestHash);
    if (prior) {
      const reconciled = await reconcilePartitionOperation(prior);
      if (reconciled.state === "committed") {
        const priorId = id ?? reconciled.allocatedIds.service_sessions?.[0];
        const priorRow = sessionRows.find((row) => row.id === priorId);
        if (!priorRow) throw new MassageError(503, "Không tải lại được ca sau khi lưu.");
        return sessionResponse(priorRow);
      }
    }

    const old = id === undefined ? undefined : sessionRows.find((row) => row.id === id);
    if (id !== undefined && !old) throw new MassageError(404, "Không tìm thấy lượt phục vụ.");
    const cardId = input.cardId ?? null;
    if (permissions && (!canEditEmployee(permissions, input.memberId)
      || (old && !canEditEmployee(permissions, old.memberId ?? 0))
      || ((old?.cardId != null || cardId !== null) && !(permissions.viewCards && permissions.editCards)))) {
      throw new MassageError(403, "Bạn chưa được cấp quyền sửa ca này.");
    }
    const card = cardId === null ? undefined : cardRows.find((row) => row.id === cardId);
    if (cardId !== null && !card) throw new MassageError(404, "Không tìm thấy thẻ đã chọn.");
    if (card?.deletedAt) throw new MassageError(404, "Thẻ đã bị xóa, không thể ghi thêm lượt sử dụng.");
    const member = memberRows.find((row) => row.id === input.memberId);
    if (!member || (member.deletedAt && old?.memberId !== member.id)) {
      throw new MassageError(404, "Không tìm thấy kỹ thuật viên đang hoạt động.");
    }
    const serviceTypeId = input.serviceTypeId ?? null;
    const service = serviceTypeId === null ? undefined : serviceRows.find((row) => row.id === serviceTypeId);
    if (serviceTypeId !== null && !service) {
      throw new MassageError(404, "Loại hình dịch vụ đã bị xóa. Hãy chọn dịch vụ khác.");
    }
    if (!old && !service) throw new MassageError(400, "Hãy chọn loại hình dịch vụ để tính lương.");
    const sameService = old?.serviceTypeId === serviceTypeId;
    const rate = sameService ? old.hourlyRate : service?.hourlyRate;
    const customerRate = sameService ? old.customerHourlyRate : service?.customerHourlyRate;
    if (!rate || rate <= 0) throw new MassageError(400, "Hãy chọn dịch vụ có mức lương mỗi giờ hợp lệ.");
    if (cardId === null && (!customerRate || customerRate <= 0) && (!old || !sameService)) {
      throw new MassageError(400, "Hãy cài giá khách trả mỗi giờ cho dịch vụ trước khi ghi ca khách lẻ.");
    }
    if (card && sessionRows
      .filter((session) => session.cardId === card.id && session.id !== id)
      .reduce((sum, session) => sum + Number(session.minutes), 0)
      + archivedRows.filter((use) => use.cardId === card.id).reduce((sum, use) => sum + Number(use.minutes), 0)
      + input.minutes > card.totalMinutes) {
      throw new MassageError(409, "Thẻ không đủ số giờ còn lại cho lượt sử dụng này.");
    }

    const sameEmployee = old?.memberId === member.id;
    const sameCard = old && old.cardId === cardId && cardId !== null;
    const serviceType = sameService ? old.serviceType : service?.name;
    if (!serviceType) throw new MassageError(400, "Hãy chọn loại hình dịch vụ.");
    const now = new Date();
    const values = {
      id: id ?? 0,
      memberId: member.id,
      employeeName: sameEmployee ? old.employeeName : member.name,
      cardId,
      customerName: sameCard ? old.customerName : card?.customerName ?? input.customerName?.trim() ?? "",
      serviceType,
      serviceTypeId,
      workDate: input.workDate,
      minutes: input.minutes,
      customerHourlyRate: customerRate ?? 0,
      customerCharge: Math.round(input.minutes * (customerRate ?? 0) / 60),
      hourlyRate: rate,
      earnings: Math.round(input.minutes * rate / 60),
      note: input.note?.trim() ?? "",
      createdAt: old?.createdAt ?? now,
    };
    const localDate = (value: Date | string) => new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
    const matchedAppointments = card
      ? appointmentRows.filter((appointment) =>
          appointment.status === "scheduled" &&
          localDate(appointment.scheduledAt) === input.workDate &&
          sameAppointmentCustomer(appointment, card),
        )
      : [];
    const eventCount = 1 + (card && !card.firstUsedAt ? 1 : 0) + matchedAppointments.length;
    const operation = await reservePartitionOperation({
      operationId,
      requestHash,
      expectedEventCount: eventCount,
      idAllocations: id === undefined ? { service_sessions: 1 } : {},
    });
    const reconciled = await reconcilePartitionOperation(operation);
    if (reconciled.state !== "committed") {
      const sessionId = id ?? reconciled.allocatedIds.service_sessions?.[0];
      if (!sessionId) throw new MassageError(503, "Không cấp được mã ca chấm công.");
      const row = { ...values, id: sessionId };
      const mutations: MutationDraft[] = [
        {
          entityType: "service_sessions",
          entityKey: partitionEntityKey("service_sessions", sessionId),
          action: "upsert" as const,
          payload: row,
        },
      ];
      if (card && !card.firstUsedAt) {
        mutations.push({
          entityType: "treatment_cards",
          entityKey: partitionEntityKey("treatment_cards", card.id),
          action: "upsert" as const,
          payload: { ...card, firstUsedAt: now },
        });
      }
      for (const appointment of matchedAppointments) {
        mutations.push({
          entityType: "appointments",
          entityKey: partitionEntityKey("appointments", appointment.id),
          action: "upsert" as const,
          payload: { ...appointment, status: "completed", updatedAt: now },
        });
      }
      await appendReservedPartitionOperation(reconciled, mutations);
      return sessionResponse(row);
    }
    const savedId = id ?? reconciled.allocatedIds.service_sessions?.[0];
    const savedRow = sessionRows.find((row) => row.id === savedId);
    if (!savedRow) throw new MassageError(503, "Không tải lại được ca sau khi lưu.");
    return sessionResponse(savedRow);
  });
}

export async function deleteSession(
  id: number,
  permissions?: FacilityPermissions,
  operationId?: string,
) {
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi xóa ca.");
    return withPartitionWriteMutex("card-ledger", async () => {
      const requestHash = hashPartitionRequest({ action: "service-session.delete", id });
      const prior = await getReservedPartitionOperation(operationId, requestHash);
      if (prior) {
        const reconciled = await reconcilePartitionOperation(prior);
        if (reconciled.state === "committed") return;
      }
      const old = await readPartitionedRowById<typeof serviceSessionsTable.$inferSelect>("service_sessions", id);
      if (!old) throw new MassageError(404, "Không tìm thấy lượt phục vụ.");
      if (old && permissions && (!(old.memberId === null
        ? permissions.allEmployees && permissions.editEmployees
        : canEditEmployee(permissions, old.memberId))
        || (old.cardId !== null && !(permissions.viewCards && permissions.editCards)))) {
        throw new MassageError(403, "Bạn chưa được cấp quyền xóa ca này.");
      }
      const operation = await reservePartitionOperation({
        operationId,
        requestHash,
        expectedEventCount: old.cardId === null ? 1 : 2,
        idAllocations: {},
      });
      const reconciled = await reconcilePartitionOperation(operation);
      if (reconciled.state === "committed") return;
      const mutations: MutationDraft[] = [];
      if (old.cardId !== null) {
        mutations.push({
          entityType: "card_usage_history",
          entityKey: partitionEntityKey("card_usage_history", old.id),
          action: "upsert",
          payload: {
            sourceSessionId: old.id,
            cardId: old.cardId,
            memberId: old.memberId,
            employeeName: old.employeeName,
            customerName: old.customerName,
            serviceType: old.serviceType,
            serviceTypeId: old.serviceTypeId,
            workDate: old.workDate,
            minutes: old.minutes,
            customerHourlyRate: old.customerHourlyRate,
            customerCharge: old.customerCharge,
            hourlyRate: old.hourlyRate,
            earnings: old.earnings,
            note: old.note,
            createdAt: old.createdAt,
          },
        });
      }
      mutations.push({
        entityType: "service_sessions",
        entityKey: partitionEntityKey("service_sessions", id),
        action: "delete",
        payload: null,
      });
      await appendReservedPartitionOperation(reconciled, mutations);
      return;
    });
  }
  await idempotentTransaction(operationId, "xóa ca", "service-session.delete", { id }, async (tx) => {
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
