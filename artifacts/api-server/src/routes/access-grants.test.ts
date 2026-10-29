import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { ownerPermissions } from "../lib/facility-permissions";
import accessGrantsRouter from "./access-grants";

test("normal SQL access-grant creation rejects a missing idempotency key before writing", async () => {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.facilityAuth = {
      authenticated: true,
      isOwner: true,
      email: `owner-${Date.now()}@example.test`,
      permissions: ownerPermissions(),
    };
    next();
  });
  app.use(accessGrantsRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/access-grants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `new-${Date.now()}@example.test`,
        permissions: {
          allEmployees: false, employeeIds: [], viewCards: false, viewRevenue: false,
          editEmployees: false, deleteEmployees: false, editCards: false, editServices: false,
          viewAppointments: false, editAppointments: false,
        },
      }),
    });
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as { error: string }).error, /Thiếu mã chống ghi trùng/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
