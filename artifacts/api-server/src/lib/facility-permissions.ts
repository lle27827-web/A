import type { FacilityPermissions } from "@workspace/api-zod";
import { GetAuthStatusResponse } from "@workspace/api-zod";
import { db, isPartitionedStorageEnabled, managerGrantsTable, readPartitionedGrantByEmail, readPartitionedTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Old email-only grants deliberately default to no privileges.
export const noPermissions = (): FacilityPermissions => ({
  allEmployees: false, employeeIds: [], viewCards: false, viewRevenue: false,
  editEmployees: false, editCards: false, editServices: false,
  deleteEmployees: false,
  viewAppointments: false, editAppointments: false,
});
export const ownerPermissions = (): FacilityPermissions => ({
  allEmployees: true, employeeIds: [], viewCards: true, viewRevenue: true,
  editEmployees: true, editCards: true, editServices: true,
  deleteEmployees: true,
  viewAppointments: true, editAppointments: true,
});
const storedPermissions = GetAuthStatusResponse.shape.permissions;
export function safePermissions(value: unknown): FacilityPermissions {
  // Existing grants predate appointment access. Keep their established rights
  // and default only the new appointment permissions to denied.
  const compatibleValue = value && typeof value === "object" && !Array.isArray(value)
    ? { viewAppointments: false, editAppointments: false, deleteEmployees: false, ...value }
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
export function canDeleteEmployee(p: FacilityPermissions, id: number): boolean {
  return p.deleteEmployees && canViewEmployee(p, id);
}
export function canManageGrant(
  status: { email: string | null; isOwner: boolean; permissions: FacilityPermissions },
  row: { email: string; grantedBy: string | null; permissions: unknown },
  ownerEmail = "",
): boolean {
  if (status.isOwner) return true;
  const normalized = (value: string) => value.trim().toLowerCase();
  return Boolean(
    status.email &&
    row.grantedBy &&
    normalized(row.grantedBy) === normalized(status.email) &&
    normalized(row.email) !== normalized(status.email) &&
    normalized(row.email) !== normalized(ownerEmail) &&
    permissionsWithinDelegationScope(status.permissions, safePermissions(row.permissions)),
  );
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
    "deleteEmployees",
    "editCards",
    "editServices",
    "viewAppointments",
    "editAppointments",
  ] as const;
  return flags.every((flag) => !delegated[flag] || grantor[flag]);
}
export async function permissionsForEmail(email: string): Promise<FacilityPermissions> {
  const grant = isPartitionedStorageEnabled()
    ? await readPartitionedGrantByEmail<typeof managerGrantsTable.$inferSelect>(email.trim().toLowerCase())
    : (await db.select({ permissions: managerGrantsTable.permissions }).from(managerGrantsTable)
      .where(eq(managerGrantsTable.email, email)).limit(1))[0];
  return safePermissions(grant?.permissions);
}
