import assert from "node:assert/strict";
import test from "node:test";
import express, { type Request } from "express";
import { once } from "node:events";
import { eq, inArray } from "drizzle-orm";
import { attendanceTable, db, managerGrantsTable, membersTable, pool, serviceSessionsTable } from "@workspace/db";
import { canDeleteEmployee, canManageGrant, canViewEmployee, noPermissions, ownerPermissions, permissionsForEmail, permissionsWithinDelegationScope, safePermissions } from "./facility-permissions";
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
  assert.equal(canDeleteEmployee({ ...scoped, deleteEmployees: true }, 7), true);
  assert.equal(canDeleteEmployee({ ...scoped, editEmployees: true }, 7), false, "editing employees must not imply delete");
  assert.equal(canManageGrant({ email: "manager@example.com", isOwner: false, permissions: ownerPermissions() },
    { email: "staff@example.com", grantedBy: " MANAGER@example.com ", permissions: scoped }), true);
  assert.equal(canManageGrant({ email: "manager@example.com", isOwner: false, permissions: ownerPermissions() },
    { email: "staff@example.com", grantedBy: null, permissions: scoped }), false, "legacy grants without a creator remain owner-managed");
  for (const p of [none, scoped, ownerPermissions()]) {
    assert.equal(await managerRequestAllowed(req("GET", "/unknown"), p), false);
  }
  assert.equal(await managerRequestAllowed(req("GET", "/member-payroll", { memberId: "7" }), scoped), true);
  assert.equal(await managerRequestAllowed(req("GET", "/member-payroll", { memberId: "8" }), scoped), false);
  assert.equal(await managerRequestAllowed(req("GET", "/service-sessions", { memberId: ["7", "8"] }), scoped), false);
  assert.equal(await managerRequestAllowed(req("GET", "/service-sessions", { memberId: "7", cardId: "9" }), scoped), false);
  for (const path of ["/massage-summary", "/treatment-cards"]) {
    assert.equal(await managerRequestAllowed(req("GET", path), scoped), false);
  }
  assert.equal(await managerRequestAllowed(req("GET", "/access-grants"), none), false);
  assert.equal(await managerRequestAllowed(req("GET", "/access-grants"), scoped), true);
  assert.equal(await managerRequestAllowed(req("POST", "/access-grants"), scoped), true);
  assert.equal(await managerRequestAllowed(req("DELETE", "/access-grants/1"), scoped), true);
  assert.equal(await managerRequestAllowed(req("DELETE", "/access-grants"), scoped), false);
  const delegable = { ...none, employeeIds: [7], editEmployees: true, viewAppointments: true };
  assert.equal(permissionsWithinDelegationScope(delegable, { ...none, employeeIds: [7], editEmployees: true, viewAppointments: true }), true);
  assert.equal(permissionsWithinDelegationScope(delegable, { ...none, employeeIds: [8] }), false);
  assert.equal(permissionsWithinDelegationScope(delegable, { ...none, viewRevenue: true }), false);
  assert.equal(permissionsWithinDelegationScope(delegable, { ...none, allEmployees: true }), false);
  assert.equal(await managerRequestAllowed(req("PATCH", "/members/7"), scoped), false);
  assert.equal(await managerRequestAllowed(req("PATCH", "/members/7"), { ...scoped, editEmployees: true }), true);
  assert.equal(await managerRequestAllowed(req("DELETE", "/members/8"), { ...scoped, editEmployees: true }), false);
  assert.equal(await managerRequestAllowed(req("DELETE", "/members/7"), { ...scoped, editEmployees: true }), false);
  assert.equal(await managerRequestAllowed(req("DELETE", "/members/7"), { ...scoped, deleteEmployees: true }), true);
  assert.equal(await managerRequestAllowed(req("POST", "/members"), { ...scoped, editEmployees: true }), false);
  assert.equal(await managerRequestAllowed(req("POST", "/members"), { ...scoped, editEmployees: true, allEmployees: true }), true);
  const cards = { ...none, viewCards: true };
  assert.equal(await managerRequestAllowed(req("GET", "/treatment-cards"), cards), true);
  assert.equal(await managerRequestAllowed(req("GET", "/massage-summary"), cards), false);
  assert.equal(await managerRequestAllowed(req("POST", "/treatment-cards/9/hours"), cards), false);
  assert.equal(await managerRequestAllowed(req("POST", "/treatment-cards/9/hours"), { ...cards, editCards: true }), true);
  assert.equal(await managerRequestAllowed(req("POST", "/service-types"), { ...none, editServices: true }), true);
  assert.equal(await managerRequestAllowed(req("GET", "/massage-summary"), { ...none, viewRevenue: true }), true);
  assert.equal(await managerRequestAllowed(req("GET", "/appointments"), none), false);
  assert.equal(await managerRequestAllowed(req("GET", "/appointments"), { ...none, viewAppointments: true }), true);
  assert.equal(await managerRequestAllowed(req("POST", "/appointments"), { ...none, viewAppointments: true }), false);
  assert.equal(await managerRequestAllowed(req("PATCH", "/appointments/1"), { ...none, viewAppointments: true }), false);
  assert.equal(await managerRequestAllowed(req("DELETE", "/appointments/1"), { ...none, viewAppointments: true }), false);
  const appointmentManager = { ...none, viewAppointments: true, editAppointments: true };
  assert.equal(await managerRequestAllowed(req("POST", "/appointments"), appointmentManager), true);
  assert.equal(await managerRequestAllowed(req("PATCH", "/appointments/1"), appointmentManager), true);
  assert.equal(await managerRequestAllowed(req("DELETE", "/appointments/1"), appointmentManager), true);
  assert.equal(await managerRequestAllowed(req("GET", "/appointments/1"), appointmentManager), false);
  const legacy = { allEmployees: true, employeeIds: [7], viewCards: true, viewRevenue: true, editEmployees: true, editCards: false, editServices: false };
  assert.deepEqual(safePermissions(legacy), { ...legacy, viewAppointments: false, editAppointments: false, deleteEmployees: false });
});

test("scoped reads and delegated grants stay within persisted manager permissions", async () => {
  const marker = `permissions-${Date.now()}`;
  const email = `${marker}@example.com`;
  const delegatedEmail = `${marker}-delegated@example.com`;
  const protectedEmail = `${marker}-protected@example.com`;
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
    app.use("/owner", (_req, res, next) => {
      res.locals.facilityAuth = { authConfigured: true, authenticated: true, isOwner: true, email: "owner@example.com", permissions: ownerPermissions() };
      next();
    }, grantsRouter);
    app.use("/manager", async (r, res, next) => {
      const p = await permissionsForEmail(email);
      res.locals.facilityAuth = { authConfigured: true, authenticated: true, isOwner: false, email, permissions: p };
      if (await managerRequestAllowed(r, p)) next();
      else res.status(403).json({ error: "Forbidden" });
    }, membersRouter, attendanceRouter, sessionsRouter, grantsRouter);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const save = (p: typeof permissions, targetEmail = email) => fetch(`${base}/owner/access-grants`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ` ${targetEmail.toUpperCase()} `, permissions: p }),
    });
    const saved = await save(permissions);
    assert.equal(saved.status, 200);
    const grant = await saved.json() as { id: number };
    assert.deepEqual(await permissionsForEmail(email), permissions);
    assert.equal((await save({ ...permissions, editCards: true })).status, 400, "edit cards requires view cards");
    const selfGrantList = await (await fetch(`${base}/manager/access-grants`)).json() as { email: string }[];
    assert.equal(selfGrantList.some((row) => row.email === email), false, "a manager cannot see their own grant");
    const delegated = await fetch(`${base}/manager/access-grants`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: delegatedEmail, permissions }),
    });
    assert.equal(delegated.status, 200, "a manager can delegate a grant within their own scope");
    const delegatedGrant = await delegated.json() as { id: number };
    assert.equal((await fetch(`${base}/manager/access-grants`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${marker}-outside@example.com`, permissions: { ...permissions, viewRevenue: true } }),
    })).status, 403, "a manager cannot grant a permission they do not have");
    assert.equal((await fetch(`${base}/manager/access-grants`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, permissions }),
    })).status, 403, "a manager cannot change their own grant");
    assert.equal((await save({ ...noPermissions(), viewRevenue: true }, protectedEmail)).status, 200);
    assert.equal((await fetch(`${base}/manager/access-grants`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: protectedEmail, permissions }),
    })).status, 403, "a manager cannot overwrite a grant outside their scope");
    const members = await (await fetch(`${base}/manager/members`)).json() as { id: number }[];
    assert.deepEqual(members.map((m) => m.id), [employees[0]]);
    const records = await (await fetch(`${base}/manager/service-sessions?month=${month}`)).json() as { memberId: number }[];
    assert.deepEqual(records.map((r) => r.memberId), [employees[0]]);
    assert.equal((await fetch(`${base}/manager/member-payroll?memberId=${employees[1]}&month=${month}`)).status, 403);
    const attRows = await (await fetch(`${base}/manager/attendance?date=${date}`)).json() as { memberId: number }[];
    assert.deepEqual(attRows.map((r) => r.memberId), [employees[0]]);
    const total = await (await fetch(`${base}/manager/attendance/summary?date=${date}`)).json() as { total: number };
    assert.equal(total.total, 1);
    assert.equal((await fetch(`${base}/manager/access-grants/${grant.id}`, { method: "DELETE" })).status, 403, "a manager cannot revoke their own grant");
    assert.equal((await fetch(`${base}/manager/access-grants`)).status, 200);
    const visibleDelegates = await (await fetch(`${base}/manager/access-grants`)).json() as { email: string }[];
    assert.ok(visibleDelegates.some((row) => row.email === delegatedEmail));
    assert.equal((await fetch(`${base}/manager/access-grants/${delegatedGrant.id}`, { method: "DELETE" })).status, 204);
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
    await db.delete(managerGrantsTable).where(inArray(managerGrantsTable.email, [email, delegatedEmail, protectedEmail]));
    if (attendance.length) await db.delete(attendanceTable).where(inArray(attendanceTable.id, attendance));
    if (visits.length) await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, visits));
    if (employees.length) await db.delete(membersTable).where(inArray(membersTable.id, employees));
  }
});
test.after(async () => { await pool.end(); });
