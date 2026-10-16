import type { FacilityPermissions } from "@workspace/api-zod";
import { GetAuthStatusResponse } from "@workspace/api-zod";
import { db, managerGrantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Old email-only grants deliberately default to no privileges.
export const noPermissions = (): FacilityPermissions => ({
  allEmployees: false, employeeIds: [], viewCards: false, viewRevenue: false,
  editEmployees: false, editCards: false, editServices: false,
});
export const ownerPermissions = (): FacilityPermissions => ({
  allEmployees: true, employeeIds: [], viewCards: true, viewRevenue: true,
  editEmployees: true, editCards: true, editServices: true,
});
const storedPermissions = GetAuthStatusResponse.shape.permissions;
export function safePermissions(value: unknown): FacilityPermissions {
  const result = storedPermissions.safeParse(value);
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
