import { isWithinRetention } from "./retention-window";
import { isWorkDateWithinFutureLimit } from "./work-date";

export function isActiveAttendanceMember<T extends { deletedAt: Date | null }>(
  member: T | null | undefined,
): member is T & { deletedAt: null } {
  return Boolean(member && member.deletedAt === null);
}

export function isEditableAttendanceDate(workDate: string): boolean {
  return isWithinRetention(workDate) && isWorkDateWithinFutureLimit(workDate);
}
