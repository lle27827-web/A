import { and, eq } from "drizzle-orm";
import {
  db,
  isPartitionedStorageEnabled,
  managerGrantsTable,
  readPartitionedGrantByEmail,
  withBusinessRegistryClient,
} from "@workspace/db";
import { commitPartitionedMutations, deleteMutation } from "./partitioned-mutations";
import {
  performEmployeeBusinessLeave,
  type BusinessLeaveDependencies,
  type BusinessLeaveInput,
} from "./business-leave-policy";
export { BusinessLeaveError, performEmployeeBusinessLeave } from "./business-leave-policy";

export async function leaveBusinessForEmployee(input: BusinessLeaveInput): Promise<void> {
  const dependencies: BusinessLeaveDependencies = {
    findMembership: async (businessId, userId) => {
      const result = await withBusinessRegistryClient((client) => client.query(
        `SELECT role, active FROM public.business_memberships
         WHERE business_id = $1::uuid AND user_id = $2
         LIMIT 1`,
        [businessId, userId],
      ));
      const row = result.rows[0];
      if (!row) return null;
      return {
        role: row.role === "owner" ? "owner" : "employee",
        active: row.active === true,
      };
    },
    findGrant: async (businessId, email) => {
      if (isPartitionedStorageEnabled()) {
        const grant = await readPartitionedGrantByEmail<typeof managerGrantsTable.$inferSelect>(email, businessId);
        return grant ? { id: grant.id } : null;
      }
      const grant = (await db.select({ id: managerGrantsTable.id }).from(managerGrantsTable)
        .where(and(
          eq(managerGrantsTable.businessId, businessId),
          eq(managerGrantsTable.email, email),
        ))
        .limit(1))[0];
      return grant ? { id: grant.id } : null;
    },
    revokeGrant: async ({ businessId, grantId, operationId }) => {
      if (isPartitionedStorageEnabled()) {
        await commitPartitionedMutations({
          operationId,
          lockName: "access-grants",
          action: "access-grant.delete",
          request: { id: grantId, businessId },
          expectedEventCount: 1,
          build: () => [deleteMutation("manager_grants", grantId)],
        });
        return;
      }
      await db.delete(managerGrantsTable).where(and(
        eq(managerGrantsTable.id, grantId),
        eq(managerGrantsTable.businessId, businessId),
      ));
    },
    deactivateMembership: async (businessId, userId) => {
      const result = await withBusinessRegistryClient((client) => client.query(
        `UPDATE public.business_memberships
         SET active = false
         WHERE business_id = $1::uuid AND user_id = $2
           AND role = 'employee' AND active = true
         RETURNING id`,
        [businessId, userId],
      ));
      return result.rowCount === 1;
    },
  };

  await performEmployeeBusinessLeave(input, dependencies);
}
