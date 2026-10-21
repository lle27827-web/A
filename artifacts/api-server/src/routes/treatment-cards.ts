import { Router, type IRouter } from "express";
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
import { massageHandler, parseInput } from "./massage-errors";

const router: IRouter = Router();
router.get("/treatment-cards", massageHandler(async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  if (isPartitionedStorageEnabled()) {
    const [cardRows, sessionRows, archivedRows, topUpRows] = await Promise.all([
      readPartitionedTable("treatment_cards"),
      readPartitionedTable("service_sessions"),
      readPartitionedTable("card_usage_history"),
      readPartitionedTable("card_top_ups"),
    ]);
    const cards = (cardRows as unknown as (typeof treatmentCardsTable.$inferSelect)[])
      .filter((card) => card.deletedAt === null)
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
      return cardResponse(card, usedMinutes, payments);
    }));
    res.json(result);
    return;
  }
  const result = await db.transaction(async (tx) => {
    const cards = await tx.select().from(treatmentCardsTable).where(isNull(treatmentCardsTable.deletedAt))
      .orderBy(desc(treatmentCardsTable.purchaseDate), desc(treatmentCardsTable.id));
    const cardIds = cards.map((card) => card.id);
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
    return ListTreatmentCardsResponse.parse(cards.map((card) => cardResponse(card, usage.get(card.id) ?? 0, history.get(card.id))));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  res.json(result);
}));
router.post("/treatment-cards", massageHandler(async (req, res) => {
  const input = parseInput(CreateTreatmentCardBody, req.body);
  res.status(201).json(CreateTreatmentCardResponse.parse(
    await createCard(input, req.get("Idempotency-Key") ?? undefined),
  ));
}));
router.patch("/treatment-cards/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateTreatmentCardParams, req.params);
  const input = parseInput(UpdateTreatmentCardBody, req.body);
  if (!Object.keys(input).length) { res.status(400).json({ error: "Chưa có thông tin cần cập nhật." }); return; }
  res.json(UpdateTreatmentCardResponse.parse(await updateCard(id, input)));
}));
router.post("/treatment-cards/:id/hours", massageHandler(async (req, res) => {
  const { id } = parseInput(AddTreatmentCardHoursParams, req.params);
  const { minutes, amount } = parseInput(AddTreatmentCardHoursBody, req.body);
  res.json(AddTreatmentCardHoursResponse.parse(
    await addCardHours(id, minutes, amount, req.get("Idempotency-Key") ?? undefined),
  ));
}));
router.delete("/treatment-cards/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeleteTreatmentCardParams, req.params);
  await deleteCard(id);
  res.sendStatus(204);
}));
export default router;
