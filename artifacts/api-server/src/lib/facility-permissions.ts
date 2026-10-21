import type { FacilityPermissions } from "@workspace/api-zod";
import { GetAuthStatusResponse } from "@workspace/api-zod";
import { db, isPartitionedStorageEnabled, managerGrantsTable, readPartitionedTable } from "@workspace/db";
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
export function permissionsWithinDelegationScope(
  grantor: FacilityPermissions,
  delegated: FacilityPermissions,
): boolean {
  if (delegated.allEmployees && !grantor.allEmployees) return false;
  if (!grantor.allEmployees && delegated.employeeIds.some((id) => !grantor.employeeIds.includes(id))) return false;
  const flags = [
    "viewCards",
    "viewRevenue",
    "editEmployees",
    "editCards",
    "editServices",
    "viewAppointments",
    "editAppointments",
  ] as const;
  return flags.every((flag) => !delegated[flag] || grantor[flag]);
}
export async function permissionsForEmail(email: string): Promise<FacilityPermissions> {
  const grant = isPartitionedStorageEnabled()
    ? (await readPartitionedTable("manager_grants") as unknown as (typeof managerGrantsTable.$inferSelect)[])
      .find((row) => row.email.trim().toLowerCase() === email.trim().toLowerCase())
    : (await db.select({ permissions: managerGrantsTable.permissions }).from(managerGrantsTable)
      .where(eq(managerGrantsTable.email, email)).limit(1))[0];
  return safePermissions(grant?.permissions);
}
