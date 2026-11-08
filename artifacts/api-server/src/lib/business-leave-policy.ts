export type BusinessLeaveMembership = {
  role: "owner" | "employee";
  active: boolean;
};

export type BusinessLeaveGrant = {
  id: number;
};

export type BusinessLeaveInput = {
  businessId: string;
  selectedBusinessId: string | null;
  userId: string;
  email: string;
  role: string | null;
  isOwner: boolean;
  isPlatformAdmin: boolean;
  operationId: string;
};

export type BusinessLeaveDependencies = {
  findMembership: (businessId: string, userId: string) => Promise<BusinessLeaveMembership | null>;
  findGrant: (businessId: string, email: string) => Promise<BusinessLeaveGrant | null>;
  revokeGrant: (input: { businessId: string; email: string; grantId: number; operationId: string }) => Promise<void>;
  deactivateMembership: (businessId: string, userId: string) => Promise<boolean>;
};

export class BusinessLeaveError extends Error {
  constructor(
    readonly statusCode: 403 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = "BusinessLeaveError";
  }
}

/**
 * Revoke the manager grant before deactivating the membership. Since those
 * records live in separate stores, this order fails closed and remains retryable.
 */
export async function performEmployeeBusinessLeave(
  input: BusinessLeaveInput,
  dependencies: BusinessLeaveDependencies,
): Promise<void> {
  if (input.businessId !== input.selectedBusinessId) {
    throw new BusinessLeaveError(403, "Chỉ có thể rời cơ sở đang chọn.");
  }
  if (input.isOwner || input.role === "owner") {
    throw new BusinessLeaveError(409, "Chủ cơ sở cần chuyển quyền sở hữu trước khi rời cơ sở.");
  }
  if (input.isPlatformAdmin || input.role !== "employee") {
    throw new BusinessLeaveError(403, "Chỉ nhân viên của cơ sở mới được rời cơ sở.");
  }

  const email = input.email.trim().toLowerCase();
  const membership = await dependencies.findMembership(input.businessId, input.userId);
  if (membership?.role === "owner") {
    throw new BusinessLeaveError(409, "Chủ cơ sở cần chuyển quyền sở hữu trước khi rời cơ sở.");
  }

  const grant = await dependencies.findGrant(input.businessId, email);
  if (!membership && !grant) {
    throw new BusinessLeaveError(404, "Không tìm thấy membership hoặc quyền tại cơ sở này.");
  }

  if (grant) {
    await dependencies.revokeGrant({
      businessId: input.businessId,
      email,
      grantId: grant.id,
      operationId: input.operationId,
    });
  }

  if (membership?.active) {
    const deactivated = await dependencies.deactivateMembership(input.businessId, input.userId);
    if (!deactivated) {
      const current = await dependencies.findMembership(input.businessId, input.userId);
      if (current?.role === "owner" && current.active) {
        throw new BusinessLeaveError(409, "Chủ cơ sở cần chuyển quyền sở hữu trước khi rời cơ sở.");
      }
      if (current?.active) {
        throw new BusinessLeaveError(503, "Chưa thể hoàn tất việc rời cơ sở. Hãy thử lại.");
      }
    }
  }
}
