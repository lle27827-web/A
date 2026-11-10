import type { FacilityPermissions } from "@workspace/api-zod";
import { GetAuthStatusResponse } from "@workspace/api-zod";
import { db, isPartitionedStorageEnabled, managerGrantsTable, readPartitionedGrantByEmail, readPartitionedTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { DEFAULT_BUSINESS_ID } from "./business-tenancy";

// Old email-only grants deliberately default to no privileges.
export const noPermissions = (): FacilityPermissions => ({
  allEmployees: false, employeeIds: [], compareAllEmployees: false, compareEmployeeIds: [],
  viewCards: false, viewRevenue: false,
  editEmployees: false, editCards: false, editServices: false,
  deleteEmployees: false,
  viewAppointments: false, editAppointments: false,
});
export const ownerPermissions = (): FacilityPermissions => ({
  allEmployees: true, employeeIds: [], compareAllEmployees: true, compareEmployeeIds: [],
  viewCards: true, viewRevenue: true,
  editEmployees: true, editCards: true, editServices: true,
  deleteEmployees: true,
  viewAppointments: true, editAppointments: true,
});
const storedPermissions = GetAuthStatusResponse.shape.permissions;
export function safePermissions(value: unknown): FacilityPermissions {
  // Existing grants predate appointment and independent comparison scopes.
  // Preserve their old comparison access, then keep the new grants independent
  // after they have been explicitly saved.
  const compatibleValue = value && typeof value === "object" && !Array.isArray(value)
    ? (() => {
      const old = value as Partial<FacilityPermissions>;
      return {
        viewAppointments: false,
        editAppointments: false,
        deleteEmployees: false,
        ...old,
        compareAllEmployees: typeof old.compareAllEmployees === "boolean" ? old.compareAllEmployees : old.allEmployees === true,
        compareEmployeeIds: Array.isArray(old.compareEmployeeIds) ? old.compareEmployeeIds : old.employeeIds ?? [],
      };
    })()
    : value;
  const result = storedPermissions.safeParse(compatibleValue);
  return result.success ? result.data : noPermissions();
}
export function canViewEmployee(p: FacilityPermissions, id: number): boolean {
  return Number.isSafeInteger(id) && id > 0 && (p.allEmployees || p.employeeIds.includes(id));
}
export function canCompareEmployee(p: FacilityPermissions, id: number): boolean {
  return Number.isSafeInteger(id) && id > 0 && (p.compareAllEmployees || p.compareEmployeeIds.includes(id));
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
  if (delegated.compareAllEmployees && !grantor.compareAllEmployees) return false;
  if (!grantor.compareAllEmployees &&
      delegated.compareEmployeeIds.some((id) => !grantor.compareEmployeeIds.includes(id))) return false;
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
export async function permissionsForEmail(
  email: string,
  businessId = DEFAULT_BUSINESS_ID,
): Promise<FacilityPermissions> {
  const grant = isPartitionedStorageEnabled()
    ? await readPartitionedGrantByEmail<typeof managerGrantsTable.$inferSelect>(email.trim().toLowerCase(), businessId)
    : (await db.select({ permissions: managerGrantsTable.permissions }).from(managerGrantsTable)
      .where(and(
        eq(managerGrantsTable.businessId, businessId),
        eq(managerGrantsTable.email, email.trim().toLowerCase()),
      )).limit(1))[0];
  return safePermissions(grant?.permissions);
}

export function hasOnlyActiveGrantEmployees(
  requestedIds: readonly number[],
  members: readonly { id: number; deletedAt: Date | null }[],
): boolean {
  const activeIds = new Set(members.filter((member) => member.deletedAt === null).map((member) => member.id));
  return requestedIds.every((id) => activeIds.has(id));
}
