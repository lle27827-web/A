import { Router, type IRouter } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { db, managerGrantsTable, membersTable } from "@workspace/db";
import { DeleteAccessGrantParams, ListAccessGrantsResponse, SaveAccessGrantBody, SaveAccessGrantResponse } from "@workspace/api-zod";
import { MassageError } from "../lib/massage";
import { safePermissions } from "../lib/facility-permissions";
import { massageHandler, parseInput } from "./massage-errors";

const router: IRouter = Router();
const output = (row: typeof managerGrantsTable.$inferSelect) => ({ id: row.id, email: row.email, permissions: safePermissions(row.permissions) });

// The global authorization gate admits only the verified owner on these routes.
router.get("/access-grants", massageHandler(async (_req, res) => {
  res.json(ListAccessGrantsResponse.parse((await db.select().from(managerGrantsTable).orderBy(asc(managerGrantsTable.email))).map(output)));
}));
router.post("/access-grants", massageHandler(async (req, res) => {
  const input = parseInput(SaveAccessGrantBody, { ...req.body, email: typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : req.body?.email });
  if (input.email === process.env.ADMIN_EMAIL?.trim().toLowerCase()) throw new MassageError(400, "Chủ sở hữu luôn có đầy đủ quyền, không cần cấp quyền.");
  const permissions = { ...input.permissions, employeeIds: [...new Set(input.permissions.employeeIds)].sort((a, b) => a - b) };
  if (permissions.editCards && !permissions.viewCards) throw new MassageError(400, "Cần quyền xem thẻ trước khi cho phép sửa thẻ.");
  if (permissions.editAppointments && !permissions.viewAppointments) throw new MassageError(400, "Cần quyền xem lịch hẹn trước khi cho phép quản lý lịch hẹn.");
  if (permissions.editEmployees && !permissions.allEmployees && !permissions.employeeIds.length) throw new MassageError(400, "Hãy chọn nhân viên được xem và chỉnh sửa.");
  if (permissions.employeeIds.length) {
    const valid = await db.select({ id: membersTable.id }).from(membersTable).where(inArray(membersTable.id, permissions.employeeIds));
    if (valid.length !== permissions.employeeIds.length) throw new MassageError(400, "Danh sách nhân viên không hợp lệ. Hãy tải lại.");
  }
  const [saved] = await db.insert(managerGrantsTable).values({ email: input.email, permissions })
    .onConflictDoUpdate({ target: managerGrantsTable.email, set: { permissions } }).returning();
  res.json(SaveAccessGrantResponse.parse(output(saved)));
}));
router.delete("/access-grants/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeleteAccessGrantParams, req.params);
  const [deleted] = await db.delete(managerGrantsTable).where(eq(managerGrantsTable.id, id)).returning({ id: managerGrantsTable.id });
  if (!deleted) throw new MassageError(404, "Quyền đã được thu hồi hoặc không tồn tại.");
  res.sendStatus(204);
}));
export default router;
