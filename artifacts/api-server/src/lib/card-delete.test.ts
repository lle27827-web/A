import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, pool, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import { deleteCard } from "./massage";

test("any active card can be archived while its remaining balance and usage history stay unchanged", async () => {
  const marker = `CardDelete-${randomUUID()}`;
  const cardIds: number[] = [];
  const sessionIds: number[] = [];

  try {
    const [partlyUsed] = await db.insert(treatmentCardsTable).values({
      customerName: marker,
      phone: "0000",
      serviceType: "Delete test",
      totalMinutes: 120,
      purchaseAmount: 120000,
      purchaseDate: "2099-03-01",
      firstUsedAt: new Date(Date.now() + 10_000),
    }).returning();
    cardIds.push(partlyUsed.id);

    const [visit] = await db.insert(serviceSessionsTable).values({
      cardId: partlyUsed.id,
      memberId: null,
      employeeName: "Test employee",
      customerName: marker,
      serviceType: "Delete test",
      serviceTypeId: null,
      workDate: "2099-03-01",
      minutes: 30,
      customerHourlyRate: 100000,
      customerCharge: 0,
      hourlyRate: 50000,
      earnings: 25000,
      note: "Preserve this visit",
    }).returning();
    sessionIds.push(visit.id);

    await deleteCard(partlyUsed.id);

    const [archivedCard] = await db.select().from(treatmentCardsTable)
      .where(eq(treatmentCardsTable.id, partlyUsed.id));
    const [retainedVisit] = await db.select().from(serviceSessionsTable)
      .where(eq(serviceSessionsTable.id, visit.id));

    assert.ok(archivedCard.deletedAt, "a partially used card can be archived at any time");
    assert.equal(archivedCard.totalMinutes, 120, "deletion does not alter the stored card balance");
    assert.equal(retainedVisit.minutes, 30, "used minutes remain recorded and are not refunded");
    assert.equal(retainedVisit.earnings, 25000, "historical employee pay remains unchanged");
    assert.equal(retainedVisit.note, "Preserve this visit");
  } finally {
    if (sessionIds.length) {
      await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, sessionIds));
    }
    if (cardIds.length) {
      await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, cardIds));
    }
    await pool.end();
  }
});
