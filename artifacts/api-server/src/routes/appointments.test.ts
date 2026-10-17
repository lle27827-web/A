import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { eq } from "drizzle-orm";
import { appointmentsTable, db, managerGrantsTable, pool } from "@workspace/db";
import { noPermissions, permissionsForEmail } from "../lib/facility-permissions";
import { managerRequestAllowed } from "../lib/owner-auth";
import appointmentsRouter from "./appointments";

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
        scheduledAt: "2026-11-02T09:30:00.000Z",
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { id: number; customerName: string; phone: string; note: string };
    appointmentIds.push(created.id);
    assert.deepEqual(
      { customerName: created.customerName, phone: created.phone, note: created.note },
      { customerName: "Khách thử", phone: "0900000000", note: "" },
    );

    const listed = await (await fetch(`${base}/appointments`)).json() as { id: number }[];
    assert.ok(listed.some((appointment) => appointment.id === created.id));

    const update = await fetch(`${base}/appointments/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Khách đã sửa",
        phone: "0911111111",
        scheduledAt: "2026-11-02T10:30:00.000Z",
        note: "Yêu cầu nhẹ nhàng",
      }),
    });
    assert.equal(update.status, 200);
    const updated = await update.json() as {
      id: number; customerName: string; phone: string; scheduledAt: string;
      note: string; createdAt: string; updatedAt: string;
    };
    assert.equal(updated.id, created.id);
    assert.equal(updated.customerName, "Khách đã sửa");
    assert.equal(updated.phone, "0911111111");
    assert.equal(updated.scheduledAt, "2026-11-02T10:30:00.000Z");
    assert.equal(updated.note, "Yêu cầu nhẹ nhàng");
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

test.after(async () => { await pool.end(); });
