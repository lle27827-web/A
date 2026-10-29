import { Router, type IRouter, type Response } from "express";
import { desc, inArray, isNull, sql } from "drizzle-orm";
import {
  cardTopUpsTable,
  cardUsageHistoryTable,
  db,
  isPartitionedStorageEnabled,
  readPartitionedTable,
  serviceSessionsTable,
  treatmentCardsTable,
} from "@workspace/db";
import {
  CreateTreatmentCardBody, CreateTreatmentCardResponse, DeleteTreatmentCardParams,
  ListTreatmentCardsResponse, UpdateTreatmentCardBody, UpdateTreatmentCardParams, UpdateTreatmentCardResponse,
  AddTreatmentCardHoursBody, AddTreatmentCardHoursParams, AddTreatmentCardHoursResponse,
} from "@workspace/api-zod";
import { addCardHours, cardResponse, createCard, deleteCard, updateCard } from "../lib/massage";
import type { OwnerAuthStatus } from "../lib/owner-auth";
import { operationIdFromRequest } from "../lib/partitioned-mutations";
import { massageHandler, parseInput } from "./massage-errors";
import { isMaskedCustomerPhone, maskCustomerPhone, matchesTreatmentCardSearch } from "../lib/customer-phone";
import { MassageError } from "../lib/massage";

const router: IRouter = Router();
function ownerView(res: Response): boolean {
  return (res.locals.facilityAuth as OwnerAuthStatus | undefined)?.isOwner === true;
}
function visibleCard<T extends { phone: string }>(card: T, isOwner: boolean): T {
  return isOwner ? card : { ...card, phone: maskCustomerPhone(card.phone) };
}

router.get("/treatment-cards", massageHandler(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const rawSearch = req.query.search;
  if (rawSearch !== undefined && (typeof rawSearch !== "string" || rawSearch.length > 160)) {
    throw new MassageError(400, "Từ khóa tìm thẻ không hợp lệ.");
  }
  const search = typeof rawSearch === "string" ? rawSearch.trim() : "";
  const isOwner = ownerView(res);
  if (isPartitionedStorageEnabled()) {
    const [cardRows, sessionRows, archivedRows, topUpRows] = await Promise.all([
      readPartitionedTable("treatment_cards"),
      readPartitionedTable("service_sessions"),
      readPartitionedTable("card_usage_history"),
      readPartitionedTable("card_top_ups"),
    ]);
    const cards = (cardRows as unknown as (typeof treatmentCardsTable.$inferSelect)[])
      .filter((card) => card.deletedAt === null)
      .filter((card) => matchesTreatmentCardSearch(card, search))
      .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.id - a.id);
    const sessions = sessionRows as unknown as (typeof serviceSessionsTable.$inferSelect)[];
    const archivedUses = archivedRows as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
    const topUps = topUpRows as unknown as (typeof cardTopUpsTable.$inferSelect)[];
    const result = ListTreatmentCardsResponse.parse(cards.map((card) => {
      const usedMinutes = sessions
        .filter((session) => session.cardId === card.id)
        .reduce((total, session) => total + Number(session.minutes), 0) +
        archivedUses
          .filter((use) => use.cardId === card.id)
          .reduce((total, use) => total + Number(use.minutes), 0);
      const payments = topUps
        .filter((topUp) => topUp.cardId === card.id)
        .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.id - a.id);
      return visibleCard(cardResponse(card, usedMinutes, payments), isOwner);
    }));
    res.json(result);
    return;
  }
  const result = await db.transaction(async (tx) => {
    const cards = await tx.select().from(treatmentCardsTable).where(isNull(treatmentCardsTable.deletedAt))
      .orderBy(desc(treatmentCardsTable.purchaseDate), desc(treatmentCardsTable.id));
    const matchingCards = cards.filter((card) => matchesTreatmentCardSearch(card, search));
    const cardIds = matchingCards.map((card) => card.id);
    const liveUse = cardIds.length ? await tx.select({
      cardId: serviceSessionsTable.cardId,
      minutes: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}), 0)`,
    }).from(serviceSessionsTable).where(inArray(serviceSessionsTable.cardId, cardIds))
      .groupBy(serviceSessionsTable.cardId) : [];
    const archivedUse = cardIds.length ? await tx.select({
      cardId: cardUsageHistoryTable.cardId,
      minutes: sql<number>`coalesce(sum(${cardUsageHistoryTable.minutes}), 0)`,
    }).from(cardUsageHistoryTable).where(inArray(cardUsageHistoryTable.cardId, cardIds))
      .groupBy(cardUsageHistoryTable.cardId) : [];
    const usage = new Map<number, number>();
    for (const row of [...liveUse, ...archivedUse]) {
      if (row.cardId !== null) usage.set(row.cardId, (usage.get(row.cardId) ?? 0) + Number(row.minutes));
    }
    const topUps = cardIds.length ? await tx.select().from(cardTopUpsTable)
      .where(inArray(cardTopUpsTable.cardId, cardIds))
      .orderBy(desc(cardTopUpsTable.paymentDate), desc(cardTopUpsTable.id)) : [];
    const history = new Map<number, typeof topUps>();
    for (const payment of topUps) {
      const items = history.get(payment.cardId) ?? [];
      items.push(payment);
      history.set(payment.cardId, items);
    }
    return ListTreatmentCardsResponse.parse(matchingCards.map((card) =>
      visibleCard(cardResponse(card, usage.get(card.id) ?? 0, history.get(card.id)), isOwner),
    ));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  res.json(result);
}));
router.post("/treatment-cards", massageHandler(async (req, res) => {
  const input = parseInput(CreateTreatmentCardBody, req.body);
  const card = await createCard(input, operationIdFromRequest(req.get("Idempotency-Key"), "bán thẻ"));
  res.status(201).json(CreateTreatmentCardResponse.parse(visibleCard(card, ownerView(res))));
}));
router.patch("/treatment-cards/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateTreatmentCardParams, req.params);
  const input = parseInput(UpdateTreatmentCardBody, req.body);
  if (!ownerView(res) && isMaskedCustomerPhone(input.phone)) delete input.phone;
  if (!Object.keys(input).length) { res.status(400).json({ error: "Chưa có thông tin cần cập nhật." }); return; }
  const card = await updateCard(id, input, operationIdFromRequest(req.get("Idempotency-Key"), "sửa thẻ"));
  res.json(UpdateTreatmentCardResponse.parse(visibleCard(card, ownerView(res))));
}));
router.post("/treatment-cards/:id/hours", massageHandler(async (req, res) => {
  const { id } = parseInput(AddTreatmentCardHoursParams, req.params);
  const { minutes, amount } = parseInput(AddTreatmentCardHoursBody, req.body);
  const card = await addCardHours(id, minutes, amount, operationIdFromRequest(req.get("Idempotency-Key"), "nạp thẻ"));
  res.json(AddTreatmentCardHoursResponse.parse(visibleCard(card, ownerView(res))));
}));
router.delete("/treatment-cards/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeleteTreatmentCardParams, req.params);
  await deleteCard(id, operationIdFromRequest(req.get("Idempotency-Key"), "xóa thẻ"));
  res.sendStatus(204);
}));
export default router;
