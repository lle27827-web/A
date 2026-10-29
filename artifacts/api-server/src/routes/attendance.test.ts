import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import attendanceRouter from "./attendance";

test("attendance create, update, and delete return 400 when Idempotency-Key is missing", async () => {
  const app = express();
  app.use(express.json());
  app.use(attendanceRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const post = await fetch(`${base}/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: 1, employeeName: "Test", workDate: today, status: "present" }),
    });
    assert.equal(post.status, 400);
    assert.match(((await post.json()) as { error: string }).error, /Thiếu mã chống ghi trùng/);

    const patch = await fetch(`${base}/attendance/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "test" }),
    });
    assert.equal(patch.status, 400);
    assert.match(((await patch.json()) as { error: string }).error, /Thiếu mã chống ghi trùng/);

    const deletion = await fetch(`${base}/attendance/1`, { method: "DELETE" });
    assert.equal(deletion.status, 400);
    assert.match(((await deletion.json()) as { error: string }).error, /Thiếu mã chống ghi trùng/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
