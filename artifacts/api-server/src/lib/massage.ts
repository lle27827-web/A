import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import {
  appendReservedPartitionOperation,
  appointmentsTable,
  cardTopUpsTable,
  cardUsageHistoryTable,
  db,
  facilityNightSettingsTable,
  getReservedPartitionOperation,
  hashPartitionRequest,
  isPartitionedStorageEnabled,
  membersTable,
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
import { shouldKeepRecordedHourlyRate } from "./employee-bonus-pay";
import { isWithinNightWindow } from "./night-service-pricing";
import { isWithinRetention } from "./retention-window";
import {
  commitPartitionedMutations,
  reconcileAndReload,
  upsertMutation,
} from "./partitioned-mutations";
import {
  currentBusinessDate,
  identityPhone,
  identityText,
  MassageError,
  type Tx,
  validDate,
  sameAppointmentCustomer,
  resolveSessionCustomerHourlyRate,
  resolveSessionHourlyRate,
  buildPartitionedSessionDeleteMutations,
} from "./massage-common";
import { idempotentTransaction } from "./massage-idempotency";
export {
  MassageError,
  buildPartitionedSessionDeleteMutations,
  currentBusinessDate,
  escapeLikePattern,
  identityPhone,
  monthBounds,
  retainedDate,
  retainedMonthBounds,
  resolveSessionCustomerHourlyRate,
  resolveSessionHourlyRate,
  sameAppointmentCustomer,
  serviceTypeHasHistory,
  validDate,
} from "./massage-common";
export { idempotentTransaction } from "./massage-idempotency";
export { deleteMember } from "./massage-employees";

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
  const topUps = await tx.select().from(cardTopUpsTable).where(and(
    eq(cardTopUpsTable.cardId, row.id),
    eq(cardTopUpsTable.businessId, row.businessId),
  ))
    .orderBy(desc(cardTopUpsTable.paymentDate), desc(cardTopUpsTable.id));
  return cardResponse(row, used, topUps);
}

async function creditCard(tx: Tx, card: typeof treatmentCardsTable.$inferSelect, minutes: number, amount: number,
  paymentDate: string, source: string, note = "", paymentMethod: "cash" | "transfer" | null = null, sellerName: string | null = null) {
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 600000 ||
      !Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) {
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
async function usedMinutes(
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
type CardValueInput = Omit<TreatmentCardInput, "purchasePaymentMethod" | "sellerName"> & {
  purchasePaymentMethod?: string | null;
  sellerName?: string | null;
};
function cardValues(input: CardValueInput) {
  validDate(input.purchaseDate);
  const customerName = input.customerName.trim();
  const serviceType = input.serviceType.trim();
  const phone = input.phone.trim();
  if (!customerName || !serviceType || !phone) throw new MassageError(400, "Cần tên khách, số điện thoại và loại dịch vụ.");
  const { mergeTargetId: _confirmation, ...data } = input;
  return { ...data, customerName, serviceType, phone, note: input.note?.trim() ?? "" };
}
function validatedCardPayment(input: { purchasePaymentMethod?: string | null; sellerName?: string | null }) {
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
export async function createCard(
  input: TreatmentCardInput,
  operationId?: string,
  businessId = "00000000-0000-4000-8000-000000000001",
) {
  const values = { ...cardValues({ ...input, ...validatedCardPayment(input) }), businessId };
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi bán thẻ.");
    return createPartitionedCard(input, values, operationId, businessId);
  }
  return idempotentTransaction(operationId, "bán thẻ", "card.create", { ...input, businessId }, async (tx) => {
    // Shared by creation and edits: changing identity cannot race a concurrent sale.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('so-cong:card-identities', 0))`);
    const identity = [identityText(values.customerName), identityPhone(values.phone), identityText(values.serviceType)];
    // Serialize identical sale requests even when no matching card exists yet.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(identity)}, 0))`);
    const candidates = await tx.select().from(treatmentCardsTable).where(and(
      eq(treatmentCardsTable.businessId, businessId),
      isNull(treatmentCardsTable.deletedAt),
      sql`lower(normalize(regexp_replace(btrim(${treatmentCardsTable.customerName}), '[[:space:]]+', ' ', 'g'), NFC)) = ${identity[0]}`,
      sql`lower(normalize(regexp_replace(btrim(${treatmentCardsTable.serviceType}), '[[:space:]]+', ' ', 'g'), NFC)) = ${identity[2]}`,
    )).orderBy(asc(treatmentCardsTable.id)).for("update");
    const existing = candidates.find((card) => identityPhone(card.phone) === identity[1]);
    if (existing) {
      if (input.mergeTargetId !== existing.id) throw new MassageError(409, "Thẻ đã có. Xác nhận cộng vào thẻ hiện có?", { mergeTargetId: existing.id });
      return { ...await creditCard(tx, existing, values.totalMinutes, values.purchaseAmount, values.purchaseDate,
        "merged_sale", values.note, values.purchasePaymentMethod as "cash" | "transfer", values.sellerName!), mergedIntoExisting: true };
    }
    if (input.mergeTargetId) throw new MassageError(409, "Thẻ cần gộp đã thay đổi. Hãy kiểm tra thông tin và lưu lại.");
    const [row] = await tx.insert(treatmentCardsTable).values(values).returning();
    return { ...cardResponse(row), mergedIntoExisting: false };
  });
}

async function createPartitionedCard(
  input: TreatmentCardInput,
  values: ReturnType<typeof cardValues> & { businessId: string },
  operationId: string,
  businessId: string,
) {
  return withPartitionWriteMutex("card-identities", async () => {
    const requestHash = hashPartitionRequest({ action: "card.create", input, businessId });
    const prior = await getReservedPartitionOperation(operationId, requestHash);
    if (prior) {
      const { operation: reconciled, rows: freshRows } = await reconcileAndReload(
        prior,
        reconcilePartitionOperation,
        () => Promise.all([
          readPartitionedTable("treatment_cards", { businessId }),
          readPartitionedTable("card_top_ups", { businessId }),
          readPartitionedTable("service_sessions", { businessId }),
          readPartitionedTable("card_usage_history", { businessId }),
        ]),
      );
      if (reconciled.state === "committed") {
        if (!freshRows) throw new MassageError(503, "Không tải lại được thẻ sau khi lưu.");
        const [freshCardRows, freshTopUpRows, freshSessionRows, freshArchivedRows] = freshRows;
        const merged = !reconciled.allocatedIds.treatment_cards?.length;
        const cardId = merged ? input.mergeTargetId : reconciled.allocatedIds.treatment_cards?.[0];
        const savedCard = (freshCardRows as unknown as (typeof treatmentCardsTable.$inferSelect)[])
          .find((card) => card.id === cardId);
        if (!savedCard) throw new MassageError(503, "Không tải lại được thẻ sau khi lưu.");
        const used = (freshSessionRows as unknown as (typeof serviceSessionsTable.$inferSelect)[])
          .filter((session) => session.cardId === cardId).reduce((sum, row) => sum + row.minutes, 0)
          + (freshArchivedRows as unknown as (typeof cardUsageHistoryTable.$inferSelect)[])
            .filter((row) => row.cardId === cardId).reduce((sum, row) => sum + row.minutes, 0);
        return {
          ...cardResponse(
            savedCard,
            used,
            (freshTopUpRows as unknown as CardTopUpRow[]).filter((row) => row.cardId === cardId),
          ),
          mergedIntoExisting: merged,
        };
      }
    }
    const [cardRowsRaw, topUpRowsRaw, sessionRowsRaw, archivedRowsRaw] = await Promise.all([
      readPartitionedTable("treatment_cards", { businessId }),
      readPartitionedTable("card_top_ups", { businessId }),
      readPartitionedTable("service_sessions", { businessId }),
      readPartitionedTable("card_usage_history", { businessId }),
    ]);
    const cards = cardRowsRaw as unknown as (typeof treatmentCardsTable.$inferSelect)[];
    const topUps = topUpRowsRaw as unknown as CardTopUpRow[];
    const sessions = sessionRowsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[];
    const archived = archivedRowsRaw as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
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
      card.businessId === businessId &&
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
      action: "card.create",
      expectedEventCount: isMerge ? 2 : 1,
      idAllocations: isMerge
        ? { card_top_ups: 1 }
        : { treatment_cards: 1 },
    });
    const { operation: reconciled, rows: freshRows } = await reconcileAndReload(
      operation,
      reconcilePartitionOperation,
      () => Promise.all([
        readPartitionedTable("treatment_cards", { businessId }),
        readPartitionedTable("card_top_ups", { businessId }),
        readPartitionedTable("service_sessions", { businessId }),
        readPartitionedTable("card_usage_history", { businessId }),
      ]),
    );
    if (reconciled.state === "committed") {
      if (!freshRows) throw new MassageError(503, "Không tải lại được thẻ sau khi lưu.");
      const [freshCardRows, freshTopUpRows, freshSessionRows, freshArchivedRows] = freshRows;
      const merged = !reconciled.allocatedIds.treatment_cards?.length;
      const cardId = merged ? input.mergeTargetId : reconciled.allocatedIds.treatment_cards?.[0];
      const savedCard = (freshCardRows as unknown as (typeof treatmentCardsTable.$inferSelect)[])
        .find((card) => card.id === cardId);
      if (!savedCard) throw new MassageError(503, "Không tải lại được thẻ sau khi lưu.");
      const used = (freshSessionRows as unknown as (typeof serviceSessionsTable.$inferSelect)[])
        .filter((session) => session.cardId === cardId).reduce((sum, row) => sum + row.minutes, 0)
        + (freshArchivedRows as unknown as (typeof cardUsageHistoryTable.$inferSelect)[])
          .filter((row) => row.cardId === cardId).reduce((sum, row) => sum + row.minutes, 0);
      return {
        ...cardResponse(
          savedCard,
          used,
          (freshTopUpRows as unknown as CardTopUpRow[]).filter((row) => row.cardId === cardId),
        ),
        mergedIntoExisting: merged,
      };
    }
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
          businessId,
          cardId: existing.id,
          minutes: values.totalMinutes,
          amount: values.purchaseAmount,
          paymentDate: values.purchaseDate,
          paymentMethod: values.purchasePaymentMethod,
          sellerName: values.sellerName,
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
                paymentMethod: values.purchasePaymentMethod,
                sellerName: values.sellerName,
                source: "merged_sale",
                note: values.note,
                createdAt: new Date(),
              } as CardTopUpRow,
            ]
          : [],
      ),
      mergedIntoExisting: isMerge,
    };
  });
}
export async function updateCard(
  id: number,
  input: TreatmentCardUpdate,
  operationId?: string,
  businessId = "00000000-0000-4000-8000-000000000001",
) {
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi sửa thẻ.");
    return withPartitionWriteMutex("card-identities", () =>
      withPartitionWriteMutex("card-ledger", async () => {
        const [cardsRaw, topUpsRaw, sessionsRaw, archivedRaw] = await Promise.all([
          readPartitionedTable("treatment_cards", { businessId }),
          readPartitionedTable("card_top_ups", { businessId }),
          readPartitionedTable("service_sessions", { businessId }),
          readPartitionedTable("card_usage_history", { businessId }),
        ]);
        const cards = cardsRaw as unknown as (typeof treatmentCardsTable.$inferSelect)[];
        const topUps = topUpsRaw as unknown as CardTopUpRow[];
        const sessions = sessionsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[];
        const archived = archivedRaw as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
        const old = cards.find((row) => row.id === id && row.businessId === businessId && row.deletedAt === null);
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
        const target = cards.filter((row) => row.id !== id && row.businessId === businessId && row.deletedAt === null)
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
            request: { id, input, businessId },
            expectedEventCount: 1,
            alreadyLocked: true,
            build: () => [upsertMutation("treatment_cards", id, updated)],
          });
          const refreshed = (await readPartitionedTable("treatment_cards", { businessId }) as unknown as (typeof treatmentCardsTable.$inferSelect)[])
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
          request: { id, input, businessId },
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
                businessId,
                cardId: target.id,
                minutes: oldFundingMinutes,
                amount: values.purchaseAmount,
                paymentDate: values.purchaseDate,
                paymentMethod: values.purchasePaymentMethod ?? null,
                sellerName: values.sellerName ?? null,
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
        const targetCard = (await readPartitionedTable("treatment_cards", { businessId }) as unknown as (typeof treatmentCardsTable.$inferSelect)[])
          .find((row) => row.id === target.id);
        if (!targetCard) throw new MassageError(503, "Không tải lại được thẻ sau khi gộp.");
        const refreshedTopUps = await readPartitionedTable("card_top_ups", { businessId }) as unknown as CardTopUpRow[];
        const refreshedSessions = await readPartitionedTable("service_sessions", { businessId }) as unknown as (typeof serviceSessionsTable.$inferSelect)[];
        const refreshedArchived = await readPartitionedTable("card_usage_history", { businessId }) as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
        const targetUsed = refreshedSessions.filter((row) => row.cardId === target.id).reduce((sum, row) => sum + row.minutes, 0) +
          refreshedArchived.filter((row) => row.cardId === target.id).reduce((sum, row) => sum + row.minutes, 0);
        return {
          ...cardResponse(targetCard, targetUsed, refreshedTopUps.filter((row) => row.cardId === target.id)),
          mergedIntoExisting: true,
        };
      }),
    );
  }
  return idempotentTransaction(operationId, "sửa thẻ", "card.update", { id, input, businessId }, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('so-cong:card-identities', 0))`);
    const [old] = await tx.select().from(treatmentCardsTable).where(and(
      eq(treatmentCardsTable.id, id),
      eq(treatmentCardsTable.businessId, businessId),
    )).for("update");
    if (!old || old.deletedAt) throw new MassageError(404, "Không tìm thấy thẻ.");
    const used = await usedMinutes(tx, id, undefined, businessId);
    const values = cardValues({ ...old, ...input });
    if (values.totalMinutes < used) throw new MassageError(409, "Tổng giờ của thẻ không thể thấp hơn số giờ đã sử dụng.");
    const [topUpTotal] = await tx.select({ minutes: sql<number>`coalesce(sum(${cardTopUpsTable.minutes}), 0)` })
      .from(cardTopUpsTable).where(and(
        eq(cardTopUpsTable.cardId, id),
        eq(cardTopUpsTable.businessId, businessId),
      ));
    if (values.totalMinutes < Number(topUpTotal.minutes)) {
      throw new MassageError(409, "Tổng giờ không thể thấp hơn số giờ đã nạp trong lịch sử.");
    }
    const identity = [identityText(values.customerName), identityPhone(values.phone), identityText(values.serviceType)];
    const matches = await tx.select().from(treatmentCardsTable).where(and(
      eq(treatmentCardsTable.businessId, businessId),
      ne(treatmentCardsTable.id, id),
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
        paymentDate: values.purchaseDate,
        paymentMethod: values.purchasePaymentMethod ?? null,
        sellerName: values.sellerName ?? null,
        source: "merged_card",
        note: `Gộp thẻ #${old.id}${values.note ? ` · ${values.note}` : ""}` });
      await tx.update(cardTopUpsTable).set({ cardId: target.id }).where(and(
        eq(cardTopUpsTable.cardId, id), eq(cardTopUpsTable.businessId, businessId),
      ));
      await tx.update(serviceSessionsTable).set({ cardId: target.id }).where(and(
        eq(serviceSessionsTable.cardId, id), eq(serviceSessionsTable.businessId, businessId),
      ));
      await tx.update(cardUsageHistoryTable).set({ cardId: target.id }).where(and(
        eq(cardUsageHistoryTable.cardId, id), eq(cardUsageHistoryTable.businessId, businessId),
      ));
      const firstUsedAt = [target.firstUsedAt, old.firstUsedAt].filter((v): v is Date => Boolean(v))
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? (used > 0 ? new Date() : null);
      const [merged] = await tx.update(treatmentCardsTable).set({ totalMinutes, firstUsedAt })
        .where(and(eq(treatmentCardsTable.id, target.id), eq(treatmentCardsTable.businessId, businessId))).returning();
      await tx.update(treatmentCardsTable).set({ deletedAt: new Date() }).where(and(
        eq(treatmentCardsTable.id, id),
        eq(treatmentCardsTable.businessId, businessId),
      ));
      return { ...await cardWithHistory(tx, merged, await usedMinutes(tx, target.id, undefined, businessId)), mergedIntoExisting: true };
    }
    if (input.mergeTargetId) throw new MassageError(409, "Thẻ cần gộp đã thay đổi. Hãy kiểm tra thông tin và lưu lại.");
    const [row] = await tx.update(treatmentCardsTable).set({
      customerName: values.customerName, phone: values.phone, serviceType: values.serviceType,
      totalMinutes: values.totalMinutes, purchaseAmount: values.purchaseAmount,
      purchaseDate: values.purchaseDate, note: values.note,
    }).where(and(
      eq(treatmentCardsTable.id, id),
      eq(treatmentCardsTable.businessId, businessId),
    )).returning();
    return cardWithHistory(tx, row, used);
  });
}
export async function deleteCard(
  id: number,
  operationId?: string,
  businessId = "00000000-0000-4000-8000-000000000001",
) {
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi xóa thẻ.");
    return withPartitionWriteMutex("card-identities", () =>
      withPartitionWriteMutex("card-ledger", async () => {
        const cardsRaw = await readPartitionedTable("treatment_cards", { businessId });
        const cards = cardsRaw as unknown as (typeof treatmentCardsTable.$inferSelect)[];
        const card = cards.find((row) => row.id === id && row.businessId === businessId && row.deletedAt === null);
        if (!card) throw new MassageError(404, "Không tìm thấy thẻ.");
        await commitPartitionedMutations({
          operationId,
          lockName: `card:${id}`,
          action: "card.delete",
          request: { id, businessId },
          expectedEventCount: 1,
          alreadyLocked: true,
          build: () => [upsertMutation("treatment_cards", id, { ...card, deletedAt: new Date() })],
        });
      }),
    );
  }
  await idempotentTransaction(operationId, "xóa thẻ", "card.delete", { id, businessId }, async (tx) => {
    const [card] = await tx.select().from(treatmentCardsTable).where(and(
      eq(treatmentCardsTable.id, id),
      eq(treatmentCardsTable.businessId, businessId),
    )).for("update");
    if (!card || card.deletedAt) throw new MassageError(404, "Không tìm thấy thẻ.");
    // Keep the card, payments, and every employee visit as audit history.
    // Active card lists and card-sale revenue exclude this archived card.
    await tx.update(treatmentCardsTable).set({ deletedAt: new Date() }).where(and(
      eq(treatmentCardsTable.id, id),
      eq(treatmentCardsTable.businessId, businessId),
    ));
  });
}

/** Additive update, serialized with usage/edit operations to avoid lost hours. */
export async function addCardHours(
  id: number,
  minutes: number,
  amount: number,
  paymentMethod: string,
  sellerName: string,
  operationId?: string,
  businessId = "00000000-0000-4000-8000-000000000001",
) {
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 600000) {
    throw new MassageError(400, "Số giờ nạp phải lớn hơn 0 và không quá 10.000 giờ.");
  }
  const tender = validatedCardPayment({ purchasePaymentMethod: paymentMethod, sellerName });
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng cho giao dịch nạp thẻ.");
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000) {
      throw new MassageError(400, "Số tiền nạp không hợp lệ.");
    }
    return withPartitionWriteMutex("card-ledger", async () => {
      const requestHash = hashPartitionRequest({ action: "card.topup", id, minutes, amount, ...tender, businessId });
      const prior = await getReservedPartitionOperation(operationId, requestHash);
      if (prior) {
        const { operation: reconciledPrior, rows: freshRows } = await reconcileAndReload(
          prior,
          reconcilePartitionOperation,
          () => Promise.all([
            readPartitionedTable("treatment_cards", { businessId }),
            readPartitionedTable("card_top_ups", { businessId }),
            readPartitionedTable("service_sessions", { businessId }),
            readPartitionedTable("card_usage_history", { businessId }),
          ]),
        );
        if (reconciledPrior.state === "committed") {
          if (!freshRows) throw new MassageError(503, "Không tải lại được thẻ sau khi nạp.");
          const [freshCardRows, freshTopUpRows, freshSessionRows, freshArchivedRows] = freshRows;
          const priorCard = (freshCardRows as unknown as (typeof treatmentCardsTable.$inferSelect)[])
            .find((row) => row.id === id);
          if (!priorCard) throw new MassageError(503, "Không tải lại được thẻ sau khi nạp.");
          const priorUsed = (freshSessionRows as unknown as (typeof serviceSessionsTable.$inferSelect)[])
            .filter((row) => row.cardId === id).reduce((sum, row) => sum + row.minutes, 0)
            + (freshArchivedRows as unknown as (typeof cardUsageHistoryTable.$inferSelect)[])
              .filter((row) => row.cardId === id).reduce((sum, row) => sum + row.minutes, 0);
          return cardResponse(
            priorCard,
            priorUsed,
            (freshTopUpRows as unknown as CardTopUpRow[]).filter((row) => row.cardId === id)
              .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.id - a.id),
          );
        }
      }
      const [cards, topUps, sessions, archived] = await Promise.all([
        readPartitionedTable("treatment_cards", { businessId }),
        readPartitionedTable("card_top_ups", { businessId }),
        readPartitionedTable("service_sessions", { businessId }),
        readPartitionedTable("card_usage_history", { businessId }),
      ]);
      const cardRows = cards as unknown as (typeof treatmentCardsTable.$inferSelect)[];
      const topUpRows = topUps as unknown as CardTopUpRow[];
      const sessionRows = sessions as unknown as (typeof serviceSessionsTable.$inferSelect)[];
      const archivedRows = archived as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
      const card = cardRows.find((row) => row.id === id && row.businessId === businessId && row.deletedAt === null);
      if (!card) throw new MassageError(404, "Không tìm thấy thẻ.");
      if (card.totalMinutes + minutes > 600000) {
        throw new MassageError(400, "Tổng số giờ của thẻ không được vượt quá 10.000 giờ.");
      }
      const operation = await reservePartitionOperation({
        operationId,
        requestHash,
        action: "card.topup",
        expectedEventCount: 2,
        idAllocations: { card_top_ups: 1 },
      });
      const reconciled = await reconcilePartitionOperation(operation);
      if (reconciled.state !== "committed") {
        const topUpId = reconciled.allocatedIds.card_top_ups?.[0];
        if (!topUpId) throw new MassageError(503, "Không cấp được mã giao dịch nạp thẻ.");
        const paymentDate = currentBusinessDate();
        const updatedCard = { ...card, totalMinutes: card.totalMinutes + minutes };
        const topUpEvent = {
          id: topUpId,
          businessId,
          cardId: id,
          minutes,
          amount,
          paymentDate,
          paymentMethod: tender.purchasePaymentMethod,
          sellerName: tender.sellerName,
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
            payload: topUpEvent,
          },
        ]);
      }
      const refreshedCards = await readPartitionedTable("treatment_cards", { businessId }) as unknown as (typeof treatmentCardsTable.$inferSelect)[];
      const refreshedCard = refreshedCards.find((row) => row.id === id);
      if (!refreshedCard) throw new MassageError(503, "Không tải lại được thẻ sau khi nạp.");
      const refreshedTopUps = await readPartitionedTable("card_top_ups", { businessId }) as unknown as CardTopUpRow[];
      const usedLive = await readPartitionedTable("service_sessions", { businessId }) as unknown as (typeof serviceSessionsTable.$inferSelect)[];
      const usedArchived = await readPartitionedTable("card_usage_history", { businessId }) as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
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
  return idempotentTransaction(operationId, "nạp thẻ", "card.topup", { id, minutes, amount, ...tender, businessId }, async (tx) => {
    const [card] = await tx.select().from(treatmentCardsTable).where(and(
      eq(treatmentCardsTable.id, id),
      eq(treatmentCardsTable.businessId, businessId),
    )).for("update");
    if (!card || card.deletedAt) throw new MassageError(404, "Không tìm thấy thẻ.");
    return creditCard(tx, card, minutes, amount, currentBusinessDate(), "topup", "", tender.purchasePaymentMethod, tender.sellerName);
  });
}

// Lock the session and affected cards in a consistent order. Card row locks
// serialize balance checks so simultaneous requests cannot overspend hours.
export async function saveSession(
  input: ServiceSessionInput,
  id?: number,
  permissions?: FacilityPermissions,
  operationId?: string,
  businessId = "00000000-0000-4000-8000-000000000001",
) {
  const workDate = validDate(input.workDate);
  if (input.cardId == null && !isWithinRetention(workDate)) {
    throw new MassageError(400, "Chỉ ghi ca khách lẻ trong 5 năm gần nhất.");
  }
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng cho ca chấm công.");
    return savePartitionedSession(input, id, permissions, operationId, businessId);
  }
  return idempotentTransaction(operationId, id === undefined ? "chấm công" : "sửa ca", "service-session.save", {
    id: id ?? null, input, businessId,
  }, async (tx) => {
    const [old] = id ? await tx.select().from(serviceSessionsTable).where(and(
      eq(serviceSessionsTable.id, id),
      eq(serviceSessionsTable.businessId, businessId),
    )).for("update") : [];
    if (id && !old) throw new MassageError(404, "Không tìm thấy lượt phục vụ.");
    const cardId = input.cardId ?? null;
    const paymentMethod: "cash" | "transfer" | null = cardId === null ? input.paymentMethod as "cash" | "transfer" : null;
    if (cardId === null && paymentMethod !== "cash" && paymentMethod !== "transfer") {
      throw new MassageError(400, "Chọn tiền mặt hoặc chuyển khoản cho ca khách lẻ.");
    }
    if (permissions && (!canEditEmployee(permissions, input.memberId)
      || (old && !canEditEmployee(permissions, old.memberId ?? 0))
      || ((old?.cardId != null || cardId !== null) && !(permissions.viewCards && permissions.editCards)))) {
      throw new MassageError(403, "Bạn chưa được cấp quyền sửa ca này.");
    }
    const ids = [...new Set([old?.cardId, cardId].filter((n): n is number => n !== null && n !== undefined))].sort((a, b) => a - b);
    let card: typeof treatmentCardsTable.$inferSelect | undefined;
    for (const lockId of ids) {
      const [row] = await tx.select().from(treatmentCardsTable).where(and(
        eq(treatmentCardsTable.id, lockId),
        eq(treatmentCardsTable.businessId, businessId),
      )).for("update");
      if (!row) throw new MassageError(404, "Không tìm thấy thẻ đã chọn.");
      if (lockId === cardId) card = row;
    }
    if (card?.deletedAt) throw new MassageError(404, "Thẻ đã bị xóa, không thể ghi thêm lượt sử dụng.");
    const lockedMemberIds = [...new Set([input.memberId, old?.memberId]
      .filter((memberId): memberId is number => memberId !== null && memberId !== undefined))]
      .sort((a, b) => a - b);
    const lockedMembers = await tx.select().from(membersTable)
      .where(and(
        inArray(membersTable.id, lockedMemberIds),
        eq(membersTable.businessId, businessId),
      ))
      .orderBy(asc(membersTable.id))
      .for("update");
    const member = lockedMembers.find((row) => row.id === input.memberId);
    if (!member || (member.deletedAt && old?.memberId !== member.id)) throw new MassageError(404, "Không tìm thấy kỹ thuật viên đang hoạt động.");
    const sameEmployee = old?.memberId === member.id;
    const serviceTypeId = input.serviceTypeId ?? null;
    const [service] = serviceTypeId !== null
      ? await tx.select().from(serviceTypesTable).where(and(
        eq(serviceTypesTable.id, serviceTypeId),
        eq(serviceTypesTable.businessId, businessId),
      )).for("share")
      : [];
    if (serviceTypeId !== null && !service) throw new MassageError(404, "Loại hình dịch vụ đã bị xóa. Hãy chọn dịch vụ khác.");
    if (!old && !service) throw new MassageError(400, "Hãy chọn loại hình dịch vụ để tính lương.");
    const sameService = old && old.serviceTypeId === serviceTypeId;
    const keepsRecordedRate = shouldKeepRecordedHourlyRate(old, member.id, serviceTypeId);
    const keepsCustomerRate = Boolean(sameService && old && old.customerHourlyRate > 0);
    const [nightSettings] = await tx.select().from(facilityNightSettingsTable)
      .where(and(
        eq(facilityNightSettingsTable.id, 1),
        eq(facilityNightSettingsTable.businessId, businessId),
      )).limit(1);
    const createdAt = old?.createdAt ?? new Date();
    const isNightShift = old
      ? old.isNightShift
      : Boolean(nightSettings?.enabled && isWithinNightWindow(createdAt, nightSettings.startTime, nightSettings.endTime));
    const useNightRates = isNightShift && Boolean(nightSettings?.enabled);
    if (useNightRates && service && ((!keepsRecordedRate && !service.nightHourlyRate) ||
      (!keepsCustomerRate && !service.nightCustomerHourlyRate))) {
      throw new MassageError(400, `Hãy cài đủ giá khách trả và tiền công ca đêm cho dịch vụ ${service.name} trong Cài đặt.`);
    }
    const rate = keepsRecordedRate
      ? old!.hourlyRate
      : useNightRates ? service?.nightHourlyRate ?? 0 : service?.hourlyRate ?? old?.hourlyRate ?? 0;
    const customerRate = resolveSessionCustomerHourlyRate(
      old?.customerHourlyRate,
      useNightRates ? service?.nightCustomerHourlyRate ?? undefined : service?.customerHourlyRate,
      Boolean(sameService),
    );
    if (!rate || rate <= 0) throw new MassageError(400, "Hãy chọn dịch vụ có mức lương mỗi giờ hợp lệ.");
    if (cardId === null && (!customerRate || customerRate <= 0) && (!old || !sameService)) {
      throw new MassageError(400, "Hãy cài giá khách trả mỗi giờ cho dịch vụ trước khi ghi ca khách lẻ.");
    }
    if (card && await usedMinutes(tx, card.id, id, businessId) + input.minutes > card.totalMinutes) {
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
      paymentMethod,
      hourlyRate: rate,
      earnings: Math.round(input.minutes * rate / 60), note: input.note?.trim() ?? "",
      isNightShift,
      businessId,
      createdAt,
    };
    const [row] = id
      ? await tx.update(serviceSessionsTable).set(values).where(and(
        eq(serviceSessionsTable.id, id),
        eq(serviceSessionsTable.businessId, businessId),
      )).returning()
      : await tx.insert(serviceSessionsTable).values(values).returning();
    if (card && !card.firstUsedAt) {
      await tx.update(treatmentCardsTable).set({ firstUsedAt: sql`clock_timestamp()` })
        .where(and(
          eq(treatmentCardsTable.id, card.id),
          eq(treatmentCardsTable.businessId, businessId),
        ));
    }
    if (card) {
      const sameDayAppointments = await tx.select().from(appointmentsTable).where(and(
        eq(appointmentsTable.businessId, businessId),
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
  businessId: string,
) {
  return withPartitionWriteMutex("card-ledger", async () => {
    const requestHash = hashPartitionRequest({ action: "service-session.save", id: id ?? null, input, businessId });
    const prior = await getReservedPartitionOperation(operationId, requestHash);
    if (prior) {
      const { operation: reconciled, rows: freshRows } = await reconcileAndReload(
        prior,
        reconcilePartitionOperation,
        () => readPartitionedTable("service_sessions", { businessId }),
      );
      if (reconciled.state === "committed") {
        if (!freshRows) throw new MassageError(503, "Không tải lại được ca sau khi lưu.");
        const priorId = id ?? reconciled.allocatedIds.service_sessions?.[0];
        const priorRow = (freshRows as unknown as (typeof serviceSessionsTable.$inferSelect)[])
          .find((row) => row.id === priorId);
        if (!priorRow) throw new MassageError(503, "Không tải lại được ca sau khi lưu.");
        return sessionResponse(priorRow);
      }
    }
    const [sessionRowsRaw, cardRowsRaw, archivedRowsRaw, memberRowsRaw, serviceRowsRaw, appointmentRowsRaw, nightSettingsRaw] =
      await Promise.all([
        readPartitionedTable("service_sessions", { businessId }),
        readPartitionedTable("treatment_cards", { businessId }),
        readPartitionedTable("card_usage_history", { businessId }),
        readPartitionedTable("members", { businessId }),
        readPartitionedTable("service_types", { businessId }),
        readPartitionedTable("appointments", { businessId }),
        readPartitionedTable("facility_night_settings", { businessId }),
      ]);
    const sessionRows = sessionRowsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[];
    const cardRows = cardRowsRaw as unknown as (typeof treatmentCardsTable.$inferSelect)[];
    const archivedRows = archivedRowsRaw as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
    const memberRows = memberRowsRaw as unknown as (typeof membersTable.$inferSelect)[];
    const serviceRows = serviceRowsRaw as unknown as (typeof serviceTypesTable.$inferSelect)[];
    const appointmentRows = appointmentRowsRaw as unknown as (typeof appointmentsTable.$inferSelect)[];
    const nightSettingsRows = nightSettingsRaw as unknown as (typeof facilityNightSettingsTable.$inferSelect)[];

    const old = id === undefined ? undefined : sessionRows.find((row) => row.id === id);
    if (id !== undefined && !old) throw new MassageError(404, "Không tìm thấy lượt phục vụ.");
    const cardId = input.cardId ?? null;
    const paymentMethod: "cash" | "transfer" | null = cardId === null ? input.paymentMethod as "cash" | "transfer" : null;
    if (cardId === null && paymentMethod !== "cash" && paymentMethod !== "transfer") {
      throw new MassageError(400, "Chọn tiền mặt hoặc chuyển khoản cho ca khách lẻ.");
    }
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
    const sameEmployee = old?.memberId === member.id;
    const sameService = old?.serviceTypeId === serviceTypeId;
    const keepsRecordedRate = shouldKeepRecordedHourlyRate(old, member.id, serviceTypeId);
    const keepsCustomerRate = Boolean(sameService && old && old.customerHourlyRate > 0);
    const nightSettings = nightSettingsRows.find((row) => row.id === 1);
    const createdAt = old?.createdAt ? new Date(old.createdAt) : new Date();
    const isNightShift = old
      ? old.isNightShift
      : Boolean(nightSettings?.enabled && isWithinNightWindow(createdAt, nightSettings.startTime, nightSettings.endTime));
    const useNightRates = isNightShift && Boolean(nightSettings?.enabled);
    if (useNightRates && service && ((!keepsRecordedRate && !service.nightHourlyRate) ||
      (!keepsCustomerRate && !service.nightCustomerHourlyRate))) {
      throw new MassageError(400, `Hãy cài đủ giá khách trả và tiền công ca đêm cho dịch vụ ${service.name} trong Cài đặt.`);
    }
    const rate = keepsRecordedRate
      ? old!.hourlyRate
      : useNightRates ? service?.nightHourlyRate ?? 0 : service?.hourlyRate ?? old?.hourlyRate ?? 0;
    const customerRate = resolveSessionCustomerHourlyRate(
      old?.customerHourlyRate,
      useNightRates ? service?.nightCustomerHourlyRate ?? undefined : service?.customerHourlyRate,
      Boolean(sameService),
    );
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
      paymentMethod,
      hourlyRate: rate,
      earnings: Math.round(input.minutes * rate / 60),
      isNightShift,
      businessId,
      createdAt,
      note: input.note?.trim() ?? "",
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
      action: "service-session.save",
      expectedEventCount: eventCount,
      idAllocations: id === undefined ? { service_sessions: 1 } : {},
    });
    const { operation: reconciled, rows: refreshedSessions } = await reconcileAndReload(
      operation,
      reconcilePartitionOperation,
      () => readPartitionedTable("service_sessions", { businessId }),
    );
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
    if (!refreshedSessions) throw new MassageError(503, "Không tải lại được ca sau khi lưu.");
    const savedRow = (refreshedSessions as unknown as (typeof serviceSessionsTable.$inferSelect)[])
      .find((row) => row.id === savedId);
    if (!savedRow) throw new MassageError(503, "Không tải lại được ca sau khi lưu.");
    return sessionResponse(savedRow);
  });
}

export async function deleteSession(
  id: number,
  permissions?: FacilityPermissions,
  operationId?: string,
  businessId = "00000000-0000-4000-8000-000000000001",
) {
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi xóa ca.");
    return withPartitionWriteMutex("card-ledger", async () => {
      const requestHash = hashPartitionRequest({ action: "service-session.delete", id, businessId });
      const prior = await getReservedPartitionOperation(operationId, requestHash);
      if (prior) {
        const reconciled = await reconcilePartitionOperation(prior);
        if (reconciled.state === "committed") return;
      }
      const old = await readPartitionedRowById<typeof serviceSessionsTable.$inferSelect>("service_sessions", id, businessId);
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
        action: "service-session.delete",
        expectedEventCount: 1,
        idAllocations: {},
      });
      const reconciled = await reconcilePartitionOperation(operation);
      if (reconciled.state === "committed") return;
      await appendReservedPartitionOperation(reconciled, buildPartitionedSessionDeleteMutations(id));
      return;
    });
  }
  await idempotentTransaction(operationId, "xóa ca", "service-session.delete", { id, businessId }, async (tx) => {
    const [old] = await tx.select().from(serviceSessionsTable).where(and(
      eq(serviceSessionsTable.id, id),
      eq(serviceSessionsTable.businessId, businessId),
    )).for("update");
    if (old && permissions && (!(old.memberId === null ? permissions.allEmployees && permissions.editEmployees : canEditEmployee(permissions, old.memberId))
      || (old.cardId !== null && !(permissions.viewCards && permissions.editCards)))) {
      throw new MassageError(403, "Bạn chưa được cấp quyền xóa ca này.");
    }
    if (!old) throw new MassageError(404, "Không tìm thấy lượt phục vụ.");
    if (old.cardId !== null) await tx.select().from(treatmentCardsTable).where(and(
      eq(treatmentCardsTable.id, old.cardId),
      eq(treatmentCardsTable.businessId, businessId),
    )).for("update");
    await tx.delete(serviceSessionsTable).where(and(
      eq(serviceSessionsTable.id, id),
      eq(serviceSessionsTable.businessId, businessId),
    ));
  });
}
