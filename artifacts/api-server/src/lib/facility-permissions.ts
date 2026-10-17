import type { FacilityPermissions } from "@workspace/api-zod";
import { GetAuthStatusResponse } from "@workspace/api-zod";
import { db, managerGrantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Old email-only grants deliberately default to no privileges.
export const noPermissions = (): FacilityPermissions => ({
  allEmployees: false, employeeIds: [], viewCards: false, viewRevenue: false,
  editEmployees: false, editCards: false, editServices: false,
  viewAppointments: false, editAppointments: false,
});
export const ownerPermissions = (): FacilityPermissions => ({
  allEmployees: true, employeeIds: [], viewCards: true, viewRevenue: true,
  editEmployees: true, editCards: true, editServices: true,
  viewAppointments: true, editAppointments: true,
});
const storedPermissions = GetAuthStatusResponse.shape.permissions;
export function safePermissions(value: unknown): FacilityPermissions {
  // Existing grants predate appointment access. Keep their established rights
  // and default only the new appointment permissions to denied.
  const compatibleValue = value && typeof value === "object" && !Array.isArray(value)
    ? { viewAppointments: false, editAppointments: false, ...value }
    : value;
  const result = storedPermissions.safeParse(compatibleValue);
  return result.success ? result.data : noPermissions();
}
export function canViewEmployee(p: FacilityPermissions, id: number): boolean {
  return Number.isSafeInteger(id) && id > 0 && (p.allEmployees || p.employeeIds.includes(id));
}
export function canEditEmployee(p: FacilityPermissions, id: number): boolean {
  return p.editEmployees && canViewEmployee(p, id);
}
export async function permissionsForEmail(email: string): Promise<FacilityPermissions> {
  const [grant] = await db.select({ permissions: managerGrantsTable.permissions }).from(managerGrantsTable)
    .where(eq(managerGrantsTable.email, email)).limit(1);
  return safePermissions(grant?.permissions);
}
