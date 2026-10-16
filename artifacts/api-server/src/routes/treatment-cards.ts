import { Router, type IRouter } from "express";
import { desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { cardTopUpsTable, db, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
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
  const result = await db.transaction(async (tx) => {
    const rows = await tx.select({ card: treatmentCardsTable, used: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}), 0)` })
      .from(treatmentCardsTable).leftJoin(serviceSessionsTable, eq(serviceSessionsTable.cardId, treatmentCardsTable.id))
      .where(isNull(treatmentCardsTable.deletedAt))
      .groupBy(treatmentCardsTable.id).orderBy(desc(treatmentCardsTable.purchaseDate), desc(treatmentCardsTable.id));
    const topUps = rows.length ? await tx.select().from(cardTopUpsTable)
      .where(inArray(cardTopUpsTable.cardId, rows.map(({ card }) => card.id)))
      .orderBy(desc(cardTopUpsTable.paymentDate), desc(cardTopUpsTable.id)) : [];
    const history = new Map<number, typeof topUps>();
    for (const payment of topUps) {
      const items = history.get(payment.cardId) ?? [];
      items.push(payment);
      history.set(payment.cardId, items);
    }
    return ListTreatmentCardsResponse.parse(rows.map(({ card, used }) => cardResponse(card, Number(used), history.get(card.id))));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  res.json(result);
}));
router.post("/treatment-cards", massageHandler(async (req, res) => {
  const input = parseInput(CreateTreatmentCardBody, req.body);
  res.status(201).json(CreateTreatmentCardResponse.parse(await createCard(input)));
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
  res.json(AddTreatmentCardHoursResponse.parse(await addCardHours(id, minutes, amount)));
}));
router.delete("/treatment-cards/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeleteTreatmentCardParams, req.params);
  await deleteCard(id);
  res.sendStatus(204);
}));
export default router;
