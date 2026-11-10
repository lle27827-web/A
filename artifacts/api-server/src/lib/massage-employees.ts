import { and, asc, eq, gte, isNull, isNotNull } from "drizzle-orm";
import {
  attendanceTable,
  isPartitionedStorageEnabled,
  membersTable,
  readPartitionedTable,
  serviceSessionsTable,
  withPartitionWriteMutex,
} from "@workspace/db";
import { canEditEmployee } from "./facility-permissions";
import { idempotentTransaction } from "./massage-idempotency";
import { currentBusinessDate, MassageError } from "./massage-common";
import { commitPartitionedMutations, deleteMutation, upsertMutation } from "./partitioned-mutations";

export async function deleteMember(
  id: number,
  operationId?: string,
  businessId = "00000000-0000-4000-8000-000000000001",
) {
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi xóa nhân viên.");
    await withPartitionWriteMutex(`member:${businessId.toLowerCase()}:${id}`, async () => {
      const [members, sessions, attendance] = await Promise.all([
        readPartitionedTable("members", { businessId }, { bypassCache: true }),
        readPartitionedTable("service_sessions", { businessId }, { bypassCache: true }),
        readPartitionedTable("attendance", { businessId }, { bypassCache: true }),
      ]);
      const member = (members as unknown as (typeof membersTable.$inferSelect)[])
        .find((row) => row.id === id && row.deletedAt === null);
      if (!member) throw new MassageError(404, "Không tìm thấy nhân viên.");
      const currentMonthStart = `${currentBusinessDate().slice(0, 7)}-01`;
      const currentSessions = (sessions as unknown as (typeof serviceSessionsTable.$inferSelect)[])
        .filter((row) => row.memberId === id && row.workDate >= currentMonthStart);
      const currentAttendance = (attendance as unknown as (typeof attendanceTable.$inferSelect)[])
        .filter((row) => row.memberId === id && row.workDate >= currentMonthStart);
      const cardUses = currentSessions.filter((row) => row.cardId !== null);
      const walkIns = currentSessions.filter((row) => row.cardId === null);
      const deletedAt = new Date();
      await commitPartitionedMutations({
        operationId,
        lockName: `member-delete:${id}`,
        action: "member.delete",
        request: { id, businessId },
        expectedEventCount: 1 + cardUses.length + walkIns.length + currentAttendance.length,
        alreadyLocked: true,
        build: () => [
          ...cardUses.map((row) => upsertMutation("service_sessions", row.id, {
            ...row, memberId: null, hourlyRate: 0, earnings: 0,
          })),
          ...walkIns.map((row) => deleteMutation("service_sessions", row.id)),
          ...currentAttendance.map((row) => deleteMutation("attendance", row.id)),
          upsertMutation("members", id, { ...member, deletedAt }),
        ],
      });
    });
    return;
  }
  await idempotentTransaction(operationId, "xóa nhân viên", "member.delete", { id, businessId }, async (tx) => {
    // Follow saveSession's session-before-member lock order to avoid deadlocks
    // with an edit already holding a visit row.
    await tx.select({ id: serviceSessionsTable.id }).from(serviceSessionsTable)
      .where(and(
        eq(serviceSessionsTable.memberId, id),
        eq(serviceSessionsTable.businessId, businessId),
      )).orderBy(asc(serviceSessionsTable.id)).for("update");
    const [member] = await tx.select({ id: membersTable.id }).from(membersTable)
      .where(and(
        eq(membersTable.id, id),
        eq(membersTable.businessId, businessId),
        isNull(membersTable.deletedAt),
      )).for("update");
    if (!member) throw new MassageError(404, "Không tìm thấy nhân viên.");
    // Scope deletion to the current business month. Earlier months are immutable
    // history, including card usage, walk-in revenue, attendance and payroll.
    const currentMonthStart = `${currentBusinessDate().slice(0, 7)}-01`;
    // Keep current-month customer card-use history and its consumed minutes, but
    // detach the deleted employee and remove current-month wage associations.
    await tx.update(serviceSessionsTable).set({
      memberId: null,
      hourlyRate: 0,
      earnings: 0,
    }).where(and(
      eq(serviceSessionsTable.memberId, id),
      eq(serviceSessionsTable.businessId, businessId),
      isNotNull(serviceSessionsTable.cardId),
      gte(serviceSessionsTable.workDate, currentMonthStart),
    ));
    // Remove only current-month walk-in sessions, preserving prior-month revenue.
    await tx.delete(serviceSessionsTable).where(and(
      eq(serviceSessionsTable.memberId, id),
      eq(serviceSessionsTable.businessId, businessId),
      isNull(serviceSessionsTable.cardId),
      gte(serviceSessionsTable.workDate, currentMonthStart),
    ));
    await tx.delete(attendanceTable).where(and(
      eq(attendanceTable.memberId, id),
      eq(attendanceTable.businessId, businessId),
      gte(attendanceTable.workDate, currentMonthStart),
    ));
    // Soft delete the profile so prior-month names, pay rates and visit details
    // remain available in historical views. No card totals or visit minutes change.
    await tx.update(membersTable).set({ deletedAt: new Date() })
      .where(and(
        eq(membersTable.id, id),
        eq(membersTable.businessId, businessId),
        isNull(membersTable.deletedAt),
      ));
  });
}
