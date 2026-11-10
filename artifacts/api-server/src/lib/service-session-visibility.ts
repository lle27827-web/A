import type { FacilityPermissions } from "@workspace/api-zod";
import { canViewEmployee } from "./facility-permissions";

export type SessionCompensationVisibility = {
  memberId: number | null;
  employeeName: string;
  hourlyRate: number;
  earnings: number;
};

export function maskSessionForEmployeePermissions<T extends SessionCompensationVisibility>(
  row: T,
  isOwner: boolean,
  permissions: FacilityPermissions,
): T {
  if (isOwner || (row.memberId !== null && canViewEmployee(permissions, row.memberId))) return row;
  return {
    ...row,
    memberId: null,
    employeeName: "Nhân viên",
    hourlyRate: 0,
    earnings: 0,
  };
}
