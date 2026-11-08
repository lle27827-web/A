import type { FacilityPermissions } from "@workspace/api-zod";
import type { BusinessRole, BusinessSummary } from "./business-tenancy";

export function personalOnlyBusinessAccess(permissions: FacilityPermissions) {
  return {
    businessAccessAvailable: false,
    businesses: [] as BusinessSummary[],
    businessId: null,
    businessName: null,
    role: null as BusinessRole | "platform_admin" | null,
    isOwner: false,
    permissions,
  };
}
