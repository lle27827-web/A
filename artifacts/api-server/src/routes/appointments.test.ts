import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { eq, inArray } from "drizzle-orm";
import {
  appointmentsTable, db, managerGrantsTable, membersTable, pool,
  serviceSessionsTable, serviceTypesTable, treatmentCardsTable,
} from "@workspace/db";
import { noPermissions, permissionsForEmail } from "../lib/facility-permissions";
import { hoChiMinhDate } from "../lib/employee-availability";
import { managerRequestAllowed } from "../lib/owner-auth";
import { saveSession } from "../lib/massage";
import appointmentsRouter from "./appointments";

function vietnamDateOffset(offset: number): string {
  const [year, month, day] = hoChiMinhDate().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function vietnamAppointmentTime(date: string, hour: number): Date {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+07:00`);
}

test("appointments require explicit view/edit grants and support create, update, list, and delete", async () => {
  const email = `appointments-${Date.now()}@example.com`;
  const appointmentIds: number[] = [];
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await db.insert(managerGrantsTable).values({
      email,
      permissions: { ...noPermissions(), viewAppointments: true },
    });

    const app = express();
    app.use(express.json());
    app.use(async (req, res, next) => {
      const permissions = await permissionsForEmail(email);
      if (await managerRequestAllowed(req, permissions)) next();
      else res.status(403).json({ error: "Forbidden" });
    });
    app.use(appointmentsRouter);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const today = vietnamDateOffset(0);
    const todayAppointment = vietnamAppointmentTime(today, 9);
    const updatedAppointment = vietnamAppointmentTime(today, 10);

    assert.equal((await fetch(`${base}/appointments`)).status, 200);
    const deniedCreate = await fetch(`${base}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerName: "Khách", phone: "0900000000", scheduledAt: new Date().toISOString() }),
    });
    assert.equal(deniedCreate.status, 403);

    await db.update(managerGrantsTable)
      .set({ permissions: { ...noPermissions(), viewAppointments: true, editAppointments: true } })
      .where(eq(managerGrantsTable.email, email));

    const create = await fetch(`${base}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "  Khách thử  ",
        phone: "  0900000000 ",
        scheduledAt: todayAppointment.toISOString(),
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { id: number; customerName: string; phone: string; request: string; note: string; status: string };
    appointmentIds.push(created.id);
    assert.deepEqual(
      { customerName: created.customerName, phone: created.phone, request: created.request, note: created.note },
      { customerName: "Khách thử", phone: "•••••••000", request: "", note: "" },
    );
    assert.equal((await db.select({ phone: appointmentsTable.phone }).from(appointmentsTable)
      .where(eq(appointmentsTable.id, created.id)))[0].phone, "0900000000");
    assert.equal(created.status, "scheduled");

    const listed = await (await fetch(`${base}/appointments`)).json() as { id: number }[];
    assert.ok(listed.some((appointment) => appointment.id === created.id));

    const update = await fetch(`${base}/appointments/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Khách đã sửa",
        phone: "0911111111",
        scheduledAt: updatedAppointment.toISOString(),
        request: "15:30, muốn gặp Lan",
        note: "Yêu cầu nhẹ nhàng",
      }),
    });
    assert.equal(update.status, 200);
    const updated = await update.json() as {
      id: number; customerName: string; phone: string; scheduledAt: string;
      request: string; note: string; status: string; createdAt: string; updatedAt: string;
    };
    assert.equal(updated.id, created.id);
    assert.equal(updated.customerName, "Khách đã sửa");
    assert.equal(updated.phone, "•••••••111");
    assert.equal(updated.scheduledAt, updatedAppointment.toISOString());
    assert.equal(updated.request, "15:30, muốn gặp Lan");
    assert.equal(updated.note, "Yêu cầu nhẹ nhàng");
    assert.equal(updated.status, "scheduled", "editing appointment details does not clear its status");
    assert.equal(updated.createdAt,
      (await db.select({ createdAt: appointmentsTable.createdAt }).from(appointmentsTable).where(eq(appointmentsTable.id, created.id)))[0].createdAt.toISOString());

    assert.equal((await fetch(`${base}/appointments/${created.id}`, { method: "DELETE" })).status, 204);
    assert.deepEqual(await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, created.id)), []);
    appointmentIds.length = 0;
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
    if (appointmentIds.length) await db.delete(appointmentsTable).where(eq(appointmentsTable.id, appointmentIds[0]));
    await db.delete(managerGrantsTable).where(eq(managerGrantsTable.email, email));
  }
});

test("appointment list hides past Vietnam dates without deleting their records", async () => {
  const appointmentIds: number[] = [];
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    const yesterday = vietnamDateOffset(-1);
    const today = vietnamDateOffset(0);
    const tomorrow = vietnamDateOffset(1);
    const created = await db.insert(appointmentsTable).values([
      { customerName: "Lịch hôm qua", phone: "", scheduledAt: vietnamAppointmentTime(yesterday, 23) },
      { customerName: "Lịch hôm nay", phone: "", scheduledAt: vietnamAppointmentTime(today, 1) },
      { customerName: "Lịch ngày mai", phone: "", scheduledAt: vietnamAppointmentTime(tomorrow, 10) },
    ]).returning({ id: appointmentsTable.id });
    appointmentIds.push(...created.map((row) => row.id));

    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.locals.facilityAuth = { isOwner: true };
      next();
    });
    app.use(appointmentsRouter);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/appointments`);
    assert.equal(response.status, 200);
    const listed = await response.json() as { id: number }[];
    assert.equal(listed.some((row) => row.id === created[0].id), false, "yesterday is hidden");
    assert.equal(listed.some((row) => row.id === created[1].id), true, "today remains visible all day");
    assert.equal(listed.some((row) => row.id === created[2].id), true, "tomorrow remains visible");

    const persisted = await db.select({ id: appointmentsTable.id }).from(appointmentsTable)
      .where(inArray(appointmentsTable.id, appointmentIds));
    assert.deepEqual(new Set(persisted.map((row) => row.id)), new Set(appointmentIds),
      "hiding past appointments does not delete database records");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
    if (appointmentIds.length) await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, appointmentIds));
  }
});

test("using a customer card completes only same-day appointments matching its name or phone", async () => {
  const marker = `appointment-card-${Date.now()}`;
  const day = "2026-10-13";
  const appointmentIds: number[] = [];
  const sessionIds: number[] = [];
  let cardId: number | undefined;
  let memberId: number | undefined;
  let serviceId: number | undefined;
  try {
    const [card] = await db.insert(treatmentCardsTable).values({
      customerName: `${marker} Client`, phone: "0901234567", serviceType: marker,
      totalMinutes: 180, purchaseAmount: 100000, purchaseDate: day,
    }).returning();
    cardId = card.id;
    const [member] = await db.insert(membersTable).values({ name: marker, hourlyRate: 0 }).returning();
    memberId = member.id;
    const [service] = await db.insert(serviceTypesTable).values({
      name: marker, customerHourlyRate: 100000, hourlyRate: 50000,
    }).returning();
    serviceId = service.id;

    const scheduledAt = new Date(`${day}T05:00:00.000Z`);
    const [phoneMatch] = await db.insert(appointmentsTable).values({
      customerName: `Other ${marker}`, phone: "090 123-4567", scheduledAt,
    }).returning();
    const [nameMatch] = await db.insert(appointmentsTable).values({
      customerName: `  ${marker.toUpperCase()}   CLIENT `, phone: "0911111111", scheduledAt,
    }).returning();
    const [otherDay] = await db.insert(appointmentsTable).values({
      customerName: `${marker} Client`, phone: "0901234567", scheduledAt: new Date("2026-10-14T05:00:00.000Z"),
    }).returning();
    const [unrelated] = await db.insert(appointmentsTable).values({
      customerName: `Unrelated ${marker}`, phone: "0922222222", scheduledAt,
    }).returning();
    appointmentIds.push(phoneMatch.id, nameMatch.id, otherDay.id, unrelated.id);

    const session = await saveSession({ memberId: member.id, serviceTypeId: service.id, cardId: card.id, workDate: day, minutes: 60, note: "" });
    sessionIds.push(session.id);
    const results = await db.select({ id: appointmentsTable.id, status: appointmentsTable.status })
      .from(appointmentsTable).where(inArray(appointmentsTable.id, appointmentIds));
    const statusById = new Map(results.map((row) => [row.id, row.status]));
    assert.equal(statusById.get(phoneMatch.id), "completed", "formatted phone matches after normalization");
    assert.equal(statusById.get(nameMatch.id), "completed", "normalized customer name can match without the phone");
    assert.equal(statusById.get(otherDay.id), "scheduled", "a different date is not completed");
    assert.equal(statusById.get(unrelated.id), "scheduled", "a different customer stays scheduled");
  } finally {
    if (sessionIds.length) await db.delete(serviceSessionsTable).where(eq(serviceSessionsTable.id, sessionIds[0]));
    if (appointmentIds.length) await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, appointmentIds));
    if (cardId) await db.delete(treatmentCardsTable).where(eq(treatmentCardsTable.id, cardId));
    if (memberId) await db.delete(membersTable).where(eq(membersTable.id, memberId));
    if (serviceId) await db.delete(serviceTypesTable).where(eq(serviceTypesTable.id, serviceId));
  }
});

test.after(async () => { await pool.end(); });
