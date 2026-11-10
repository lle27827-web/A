import type { FacilityPermissions } from "@workspace/api-zod";
import { canViewEmployee } from "./facility-permissions";

export type SessionCompensationVisibility = {
  memberId: number | null;
  employeeName: string;
  hourlyRate: number;
  earnings: number;
};

export type ArchivedCardUseSource = {
  sourceSessionId: number;
  cardId: number | null;
  memberId: number | null;
  employeeName: string;
  customerName: string;
  serviceTypeId: number | null;
  serviceType: string;
  workDate: string;
  minutes: number;
  customerHourlyRate: number;
  customerCharge: number;
  hourlyRate: number;
  earnings: number;
  isNightShift: boolean;
  note: string | null;
  createdAt: Date | string;
};

export function archivedCardUseToSession(row: ArchivedCardUseSource) {
  return {
    id: row.sourceSessionId,
    cardId: row.cardId,
    memberId: row.memberId,
    employeeName: row.employeeName,
    customerName: row.customerName,
    serviceTypeId: row.serviceTypeId,
    serviceType: row.serviceType,
    workDate: row.workDate,
    minutes: row.minutes,
    customerHourlyRate: row.customerHourlyRate,
    customerCharge: row.customerCharge,
    paymentMethod: null,
    hourlyRate: row.hourlyRate,
    earnings: row.earnings,
    isNightShift: row.isNightShift,
    note: row.note,
    createdAt: new Date(row.createdAt).toISOString(),
    archived: true as const,
  };
}

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
