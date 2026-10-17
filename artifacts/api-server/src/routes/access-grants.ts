import { Router, type IRouter, type Response } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { db, managerGrantsTable, membersTable } from "@workspace/db";
import { DeleteAccessGrantParams, ListAccessGrantsResponse, SaveAccessGrantBody, SaveAccessGrantResponse } from "@workspace/api-zod";
import { MassageError } from "../lib/massage";
import { permissionsWithinDelegationScope, safePermissions } from "../lib/facility-permissions";
import type { OwnerAuthStatus } from "../lib/owner-auth";
import { massageHandler, parseInput } from "./massage-errors";

const router: IRouter = Router();
const output = (row: typeof managerGrantsTable.$inferSelect) => ({ id: row.id, email: row.email, permissions: safePermissions(row.permissions) });
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const ownerEmail = () => normalizeEmail(process.env.ADMIN_EMAIL ?? "");

function currentStatus(res: Response): OwnerAuthStatus {
  const status = res.locals.facilityAuth as OwnerAuthStatus | undefined;
  if (!status?.authenticated) throw new MassageError(401, "Vui lòng đăng nhập để quản lý quyền.");
  return status;
}

function canManageGrant(status: OwnerAuthStatus, row: typeof managerGrantsTable.$inferSelect): boolean {
  if (status.isOwner) return true;
  return Boolean(
    status.email &&
    normalizeEmail(row.email) !== status.email &&
    normalizeEmail(row.email) !== ownerEmail() &&
    permissionsWithinDelegationScope(status.permissions, safePermissions(row.permissions)),
  );
}

router.get("/access-grants", massageHandler(async (_req, res) => {
  const status = currentStatus(res);
  const rows = await db.select().from(managerGrantsTable).orderBy(asc(managerGrantsTable.email));
  const visible = status.isOwner ? rows : rows.filter((row) => canManageGrant(status, row));
  res.json(ListAccessGrantsResponse.parse(visible.map(output)));
}));
router.post("/access-grants", massageHandler(async (req, res) => {
  const status = currentStatus(res);
  const input = parseInput(SaveAccessGrantBody, { ...req.body, email: typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : req.body?.email });
  if (input.email === ownerEmail()) throw new MassageError(400, "Chủ sở hữu luôn có đầy đủ quyền, không cần cấp quyền.");
  if (!status.isOwner && (!status.email || input.email === status.email)) {
    throw new MassageError(403, "Quản lý không thể tự cấp hoặc sửa quyền của chính mình.");
  }
  const permissions = {
    ...input.permissions,
    employeeIds: input.permissions.allEmployees ? [] : [...new Set(input.permissions.employeeIds)].sort((a, b) => a - b),
  };
  if (permissions.editCards && !permissions.viewCards) throw new MassageError(400, "Cần quyền xem thẻ trước khi cho phép sửa thẻ.");
  if (permissions.editAppointments && !permissions.viewAppointments) throw new MassageError(400, "Cần quyền xem lịch hẹn trước khi cho phép quản lý lịch hẹn.");
  if (permissions.editEmployees && !permissions.allEmployees && !permissions.employeeIds.length) throw new MassageError(400, "Hãy chọn nhân viên được xem và chỉnh sửa.");
  if (!status.isOwner) {
    if (!permissionsWithinDelegationScope(status.permissions, permissions)) {
      throw new MassageError(403, "Chỉ được cấp quyền bằng hoặc thấp hơn phạm vi quyền của bạn.");
    }
    const [existing] = await db.select().from(managerGrantsTable)
      .where(eq(managerGrantsTable.email, input.email)).limit(1);
    if (existing && !canManageGrant(status, existing)) {
      throw new MassageError(403, "Bạn không thể sửa quyền đã được cấp vượt phạm vi của mình.");
    }
  }
  if (permissions.employeeIds.length) {
    const valid = await db.select({ id: membersTable.id }).from(membersTable).where(inArray(membersTable.id, permissions.employeeIds));
    if (valid.length !== permissions.employeeIds.length) throw new MassageError(400, "Danh sách nhân viên không hợp lệ. Hãy tải lại.");
  }
  const [saved] = await db.insert(managerGrantsTable).values({ email: input.email, permissions })
    .onConflictDoUpdate({ target: managerGrantsTable.email, set: { permissions } }).returning();
  res.json(SaveAccessGrantResponse.parse(output(saved)));
}));
router.delete("/access-grants/:id", massageHandler(async (req, res) => {
  const status = currentStatus(res);
  const { id } = parseInput(DeleteAccessGrantParams, req.params);
  const [existing] = await db.select().from(managerGrantsTable).where(eq(managerGrantsTable.id, id)).limit(1);
  if (!existing) throw new MassageError(404, "Quyền đã được thu hồi hoặc không tồn tại.");
  if (!canManageGrant(status, existing)) {
    throw new MassageError(403, "Bạn không thể thu hồi quyền vượt phạm vi của mình.");
  }
  const [deleted] = await db.delete(managerGrantsTable).where(eq(managerGrantsTable.id, id)).returning({ id: managerGrantsTable.id });
  if (!deleted) throw new MassageError(404, "Quyền đã được thu hồi hoặc không tồn tại.");
  res.sendStatus(204);
}));
export default router;
