import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, pool, isPartitionedStorageEnabled, serviceSessionsTable, serviceTypesTable } from "@workspace/db";
import serviceTypesRouter from "./service-types";

test("deleting a used service keeps historical snapshots and allows a new independent service with the same name", {
  skip: isPartitionedStorageEnabled() ? "Run the regular-database integration test with partitioning disabled." : false,
}, async () => {
  const name = `Delete-and-recreate-${randomUUID()}`;
  const serviceIds: number[] = [];
  let sessionId: number | undefined;
  const app = express();
  app.use(serviceTypesRouter);
  const server = createServer(app);

  try {
    const [oldService] = await db.insert(serviceTypesTable).values({
      name, customerHourlyRate: 220000, hourlyRate: 110000,
    }).returning();
    serviceIds.push(oldService.id);
    const [session] = await db.insert(serviceSessionsTable).values({
      employeeName: "Kiểm thử",
      customerName: "Khách kiểm thử",
      serviceType: name,
      serviceTypeId: oldService.id,
      workDate: "2098-01-02",
      minutes: 60,
      customerHourlyRate: 220000,
      customerCharge: 220000,
      hourlyRate: 110000,
      earnings: 110000,
      note: "Lịch sử phải được giữ",
    }).returning();
    sessionId = session.id;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/service-types/${oldService.id}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": randomUUID() },
    });
    assert.equal(response.status, 204);

    const [keptSession] = await db.select().from(serviceSessionsTable)
      .where(eq(serviceSessionsTable.id, session.id));
    assert.equal(keptSession.serviceTypeId, null, "the removed catalog row is no longer linked to the old session");
    assert.equal(keptSession.serviceType, name, "the historical service name remains");
    assert.equal(keptSession.customerHourlyRate, 220000);
    assert.equal(keptSession.hourlyRate, 110000);
    assert.equal(keptSession.earnings, 110000);

    const [newService] = await db.insert(serviceTypesTable).values({
      name, customerHourlyRate: 250000, hourlyRate: 140000,
    }).returning();
    serviceIds.push(newService.id);
    assert.notEqual(newService.id, oldService.id, "the reused name gets a new service identity");
    assert.equal(keptSession.serviceTypeId, null, "the old session stays separate from the recreated service");
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    if (sessionId) await db.delete(serviceSessionsTable).where(eq(serviceSessionsTable.id, sessionId));
    if (serviceIds.length) await db.delete(serviceTypesTable).where(inArray(serviceTypesTable.id, serviceIds));
    await pool.end();
  }
});
