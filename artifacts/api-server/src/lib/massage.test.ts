import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool, membersTable, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import { cardResponse, createCard, deleteCard, deleteSession, MassageError, saveSession, updateCard } from "./massage";

test("card balance and service payroll stay consistent through edits and concurrent use", async () => {
  const marker = `Verify-${randomUUID()}`;
  const cards: number[] = [];
  const sessions: number[] = [];
  let memberId: number | undefined;
  const record = async (input: Parameters<typeof saveSession>[0], id?: number) => {
    const session = await saveSession(input, id);
    if (!sessions.includes(session.id)) sessions.push(session.id);
    return session;
  };
  const balance = async (cardId: number) => {
    const [row] = await db.select({ used: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}), 0)` })
      .from(serviceSessionsTable).where(eq(serviceSessionsTable.cardId, cardId));
    return Number(row.used);
  };
  const fails = (status: number) => (error: unknown) => error instanceof MassageError && error.status === status;
  try {
    const [member] = await db.insert(membersTable).values({ name: marker, hourlyRate: 100000 }).returning();
    memberId = member.id;
    const makeCard = async (minutes: number) => {
      const card = await createCard({
        customerName: marker, phone: "0000000000", serviceType: "Dịch vụ kiểm tra",
        totalMinutes: minutes, purchaseAmount: 1000000, purchaseDate: "2026-10-13",
      });
      cards.push(card.id);
      return card;
    };
    const a = await makeCard(600);
    const b = await makeCard(120);
    const c = await makeCard(30);
    const input = { memberId, cardId: a.id, workDate: "2026-10-13", minutes: 60, note: marker };
    const first = await record(input);
    assert.equal(first.earnings, 100000);
    assert.equal(await balance(a.id), 60);
    await db.update(membersTable).set({ hourlyRate: 200000 }).where(eq(membersTable.id, memberId));
    const edited = await record({ ...input, minutes: 90 }, first.id);
    assert.equal(edited.hourlyRate, 100000, "historical hourly rate must not change");
    assert.equal(edited.earnings, 150000);
    const second = await record({ ...input, minutes: 30 });
    assert.equal(second.hourlyRate, 200000);
    assert.equal(second.earnings, 100000);
    assert.equal(await balance(a.id), 120);
    await deleteSession(second.id);
    assert.equal(await balance(a.id), 90, "deleting a visit restores card hours");
    await assert.rejects(record({ ...input, minutes: 600 }), fails(409));
    await assert.rejects(updateCard(a.id, { totalMinutes: 80 }), fails(409));
    await assert.rejects(record({ ...input, workDate: "2026-02-31" }), fails(400));
    await assert.rejects(deleteCard(a.id), fails(409));
    await assert.rejects(record({ ...input, cardId: c.id, minutes: 90 }, first.id), fails(409));
    assert.equal(await balance(a.id), 90, "failed card transfer must roll back");
    assert.equal(await balance(c.id), 0);
    await record({ ...input, cardId: b.id, minutes: 90 }, first.id);
    assert.equal(await balance(a.id), 0);
    assert.equal(await balance(b.id), 90);
    const concurrent = await Promise.allSettled([
      record({ ...input, cardId: b.id, minutes: 30 }),
      record({ ...input, cardId: b.id, minutes: 30 }),
    ]);
    assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = concurrent.find((r) => r.status === "rejected");
    assert.ok(rejected?.status === "rejected" && fails(409)(rejected.reason));
    assert.equal(await balance(b.id), 120, "concurrent uses cannot overdraw the card");
    const [row] = await db.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, b.id));
    assert.equal(cardResponse(row, 120).phone, "•••• 0000");
    assert.equal(cardResponse(row, 120, true).phone, "0000000000");
    await db.delete(membersTable).where(eq(membersTable.id, memberId));
    const [retained] = await db.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, first.id));
    assert.equal(retained.memberId, null);
    assert.equal(retained.employeeName, marker);
    assert.equal(retained.earnings, 150000);
  } finally {
    if (sessions.length) await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, sessions));
    if (cards.length) await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, cards));
    if (memberId) await db.delete(membersTable).where(eq(membersTable.id, memberId));
    await pool.end();
  }
});
