import assert from "node:assert/strict";
import test from "node:test";
import express, { type Request } from "express";
import { once } from "node:events";
import { eq, inArray } from "drizzle-orm";
import { attendanceTable, db, managerGrantsTable, membersTable, pool, serviceSessionsTable } from "@workspace/db";
import { canViewEmployee, noPermissions, ownerPermissions, permissionsForEmail, safePermissions } from "./facility-permissions";
import { managerRequestAllowed } from "./owner-auth";
import membersRouter from "../routes/members";
import attendanceRouter from "../routes/attendance";
import sessionsRouter from "../routes/service-sessions";
import grantsRouter from "../routes/access-grants";
import { createEmployee } from "./employee-history";
import { deleteSession, saveSession } from "./massage";

const req = (method: string, path: string, query = {}, body = {}) => ({ method, path, query, body }) as Request;

test("permission policy denies by default; employee, card, revenue and edit rights are independent", async () => {
  const none = noPermissions();
  assert.deepEqual(safePermissions({}), none);
  assert.deepEqual(safePermissions({ ...none, editEmployees: "true" }), none);
  const scoped = { ...none, employeeIds: [7] };
  assert.equal(canViewEmployee(scoped, 7), true);
  assert.equal(canViewEmployee(scoped, 8), false);
  assert.equal(canViewEmployee(ownerPermissions(), 0), false);
  for (const p of [none, scoped, ownerPermissions()]) {
    for (const method of ["GET", "POST", "DELETE"]) {
      assert.equal(await managerRequestAllowed(req(method, "/access-grants"), p), false, "only owner gate can admit grant management");
    }
    assert.equal(await managerRequestAllowed(req("GET", "/unknown"), p), false);
  }
  assert.equal(await managerRequestAllowed(req("GET", "/member-payroll", { memberId: "7" }), scoped), true);
  assert.equal(await managerRequestAllowed(req("GET", "/member-payroll", { memberId: "8" }), scoped), false);
  assert.equal(await managerRequestAllowed(req("GET", "/service-sessions", { memberId: ["7", "8"] }), scoped), false);
  assert.equal(await managerRequestAllowed(req("GET", "/service-sessions", { memberId: "7", cardId: "9" }), scoped), false);
  for (const path of ["/massage-summary", "/treatment-cards", "/access-grants"]) {
    assert.equal(await managerRequestAllowed(req("GET", path), scoped), false);
  }
  assert.equal(await managerRequestAllowed(req("PATCH", "/members/7"), scoped), false);
  assert.equal(await managerRequestAllowed(req("PATCH", "/members/7"), { ...scoped, editEmployees: true }), true);
  assert.equal(await managerRequestAllowed(req("DELETE", "/members/8"), { ...scoped, editEmployees: true }), false);
  assert.equal(await managerRequestAllowed(req("POST", "/members"), { ...scoped, editEmployees: true }), false);
  assert.equal(await managerRequestAllowed(req("POST", "/members"), { ...scoped, editEmployees: true, allEmployees: true }), true);
  const cards = { ...none, viewCards: true };
  assert.equal(await managerRequestAllowed(req("GET", "/treatment-cards"), cards), true);
  assert.equal(await managerRequestAllowed(req("GET", "/massage-summary"), cards), false);
  assert.equal(await managerRequestAllowed(req("POST", "/treatment-cards/9/hours"), cards), false);
  assert.equal(await managerRequestAllowed(req("POST", "/treatment-cards/9/hours"), { ...cards, editCards: true }), true);
  assert.equal(await managerRequestAllowed(req("POST", "/service-types"), { ...none, editServices: true }), true);
  assert.equal(await managerRequestAllowed(req("GET", "/massage-summary"), { ...none, viewRevenue: true }), true);
});

test("scoped reads, grants and revocation are enforced using persisted permissions", async () => {
  const marker = `permissions-${Date.now()}`;
  const email = `${marker}@example.com`;
  const employees: number[] = [], visits: number[] = [], attendance: number[] = [];
  const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date());
  const date = `${month}-01`;
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    for (const label of ["Allowed", "Hidden"]) {
      const member = await createEmployee({ name: `${marker}-${label}`, hourlyRate: 40000 });
      employees.push(member.id);
      const [visit] = await db.insert(serviceSessionsTable).values({
        memberId: member.id, employeeName: member.name, serviceType: marker,
        workDate: date, minutes: 60, hourlyRate: 40000, earnings: 40000,
      }).returning();
      visits.push(visit.id);
      const [att] = await db.insert(attendanceTable).values({ memberId: member.id, employeeName: member.name, workDate: date, status: "present" }).returning();
      attendance.push(att.id);
    }
    const permissions = { ...noPermissions(), employeeIds: [employees[0]], editEmployees: true };
    assert.deepEqual(await permissionsForEmail(email), noPermissions());
    const app = express();
    app.use(express.json());
    // Local test harness models the output of verified Clerk auth; production has no override.
    app.use("/owner", (_req, res, next) => { res.locals.facilityAuth = { isOwner: true, permissions: ownerPermissions() }; next(); }, grantsRouter);
    app.use("/manager", async (r, res, next) => {
      const p = await permissionsForEmail(email);
      res.locals.facilityAuth = { authenticated: true, isOwner: false, permissions: p };
      if (await managerRequestAllowed(r, p)) next();
      else res.status(403).json({ error: "Forbidden" });
    }, membersRouter, attendanceRouter, sessionsRouter, grantsRouter);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const save = (p: typeof permissions) => fetch(`${base}/owner/access-grants`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ` ${email.toUpperCase()} `, permissions: p }),
    });
    const saved = await save(permissions);
    assert.equal(saved.status, 200);
    const grant = await saved.json() as { id: number };
    assert.deepEqual(await permissionsForEmail(email), permissions);
    assert.equal((await save({ ...permissions, editCards: true })).status, 400, "edit cards requires view cards");
    const members = await (await fetch(`${base}/manager/members`)).json() as { id: number }[];
    assert.deepEqual(members.map((m) => m.id), [employees[0]]);
    const records = await (await fetch(`${base}/manager/service-sessions?month=${month}`)).json() as { memberId: number }[];
    assert.deepEqual(records.map((r) => r.memberId), [employees[0]]);
    assert.equal((await fetch(`${base}/manager/member-payroll?memberId=${employees[1]}&month=${month}`)).status, 403);
    const attRows = await (await fetch(`${base}/manager/attendance?date=${date}`)).json() as { memberId: number }[];
    assert.deepEqual(attRows.map((r) => r.memberId), [employees[0]]);
    const total = await (await fetch(`${base}/manager/attendance/summary?date=${date}`)).json() as { total: number };
    assert.equal(total.total, 1);
    assert.equal((await fetch(`${base}/manager/access-grants`)).status, 403);
    assert.equal(await managerRequestAllowed(req("PATCH", `/service-sessions/${visits[1]}`, {}, { memberId: employees[0] }), permissions), false, "old employee must also be allowed");
    assert.equal(await managerRequestAllowed(req("PATCH", `/service-sessions/${visits[0]}`, {}, { memberId: employees[1] }), permissions), false, "new employee must be allowed");
    assert.equal(await managerRequestAllowed(req("PATCH", `/service-sessions/${visits[0]}`, {}, { memberId: employees[0] }), permissions), true);
    assert.equal(await managerRequestAllowed(req("PATCH", `/service-sessions/${visits[0]}`, {}, { memberId: employees[0], cardId: 1 }), permissions), false);
    await assert.rejects(deleteSession(visits[1], permissions), (e: unknown) => (e as { status: number }).status === 403);
    await assert.rejects(saveSession({ memberId: employees[0], workDate: date, minutes: 60, note: "" }, visits[1], permissions),
      (e: unknown) => (e as { status: number }).status === 403, "locked source row must still belong to permitted scope");
    assert.equal((await db.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, visits[1])))[0].memberId, employees[1]);
    assert.equal((await fetch(`${base}/owner/access-grants/${grant.id}`, { method: "DELETE" })).status, 204);
    assert.deepEqual(await permissionsForEmail(email), noPermissions());
    const revokedMembers = await (await fetch(`${base}/manager/members`)).json();
    assert.deepEqual(revokedMembers, []);
    assert.equal((await fetch(`${base}/manager/member-payroll?memberId=${employees[0]}&month=${month}`)).status, 403);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
    await db.delete(managerGrantsTable).where(eq(managerGrantsTable.email, email));
    if (attendance.length) await db.delete(attendanceTable).where(inArray(attendanceTable.id, attendance));
    if (visits.length) await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, visits));
    if (employees.length) await db.delete(membersTable).where(inArray(membersTable.id, employees));
  }
});
test.after(async () => { await pool.end(); });
