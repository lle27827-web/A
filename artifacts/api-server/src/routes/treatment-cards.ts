import { Router, type IRouter } from "express";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { db, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import {
  CreateTreatmentCardBody, CreateTreatmentCardResponse, DeleteTreatmentCardParams,
  ListTreatmentCardsResponse, UpdateTreatmentCardBody, UpdateTreatmentCardParams, UpdateTreatmentCardResponse,
  AddTreatmentCardHoursBody, AddTreatmentCardHoursParams, AddTreatmentCardHoursResponse,
} from "@workspace/api-zod";
import { getAccessStatus, requireEditor } from "../middlewares/owner";
import { addCardHours, cardResponse, createCard, deleteCard, updateCard } from "../lib/massage";
import { massageHandler, parseInput } from "./massage-errors";

const router: IRouter = Router();
router.get("/treatment-cards", massageHandler(async (req, res) => {
  const owner = (await getAccessStatus(req)).canManage;
  res.set("Cache-Control", "private, no-store");
  const rows = await db.select({ card: treatmentCardsTable, used: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}), 0)` })
    .from(treatmentCardsTable).leftJoin(serviceSessionsTable, eq(serviceSessionsTable.cardId, treatmentCardsTable.id))
    .where(isNull(treatmentCardsTable.deletedAt))
    .groupBy(treatmentCardsTable.id).orderBy(desc(treatmentCardsTable.purchaseDate), desc(treatmentCardsTable.id));
  res.json(ListTreatmentCardsResponse.parse(rows.map(({ card, used }) => cardResponse(card, Number(used), owner))));
}));
router.post("/treatment-cards", requireEditor, massageHandler(async (req, res) => {
  const input = parseInput(CreateTreatmentCardBody, req.body);
  res.status(201).json(CreateTreatmentCardResponse.parse(await createCard(input)));
}));
router.patch("/treatment-cards/:id", requireEditor, massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateTreatmentCardParams, req.params);
  const input = parseInput(UpdateTreatmentCardBody, req.body);
  if (!Object.keys(input).length) { res.status(400).json({ error: "Chưa có thông tin cần cập nhật." }); return; }
  res.json(UpdateTreatmentCardResponse.parse(await updateCard(id, input)));
}));
router.post("/treatment-cards/:id/hours", requireEditor, massageHandler(async (req, res) => {
  const { id } = parseInput(AddTreatmentCardHoursParams, req.params);
  const { minutes } = parseInput(AddTreatmentCardHoursBody, req.body);
  res.json(AddTreatmentCardHoursResponse.parse(await addCardHours(id, minutes)));
}));
router.delete("/treatment-cards/:id", requireEditor, massageHandler(async (req, res) => {
  const { id } = parseInput(DeleteTreatmentCardParams, req.params);
  await deleteCard(id);
  res.sendStatus(204);
}));
export default router;
