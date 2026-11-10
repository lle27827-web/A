import { createClerkClient } from "@clerk/backend";
import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { DatabaseFailoverInProgressError, db, attendanceTable, isPartitionedStorageEnabled, readPartitionedRowById, serviceSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { FacilityPermissions } from "@workspace/api-zod";
import { canCompareEmployee, canDeleteEmployee, canEditEmployee, canViewEmployee, noPermissions, ownerPermissions, permissionsForEmail } from "./facility-permissions";
import { isValidRetentionCronAuthorization } from "./retention-auth";
import { createAsyncTtlCache } from "./user-identity-cache";
import {
  DEFAULT_BUSINESS_ID,
  isVerifiedAdminIdentity,
  listBusinessesForIdentity,
  restorePendingDefaultBusinessOwnership,
  type BusinessRole,
  type BusinessSummary,
} from "./business-tenancy";
import { and } from "drizzle-orm";
import { personalOnlyBusinessAccess } from "./business-access-policy";

const secretKey = process.env.APP_CLERK_SECRET_KEY?.trim();
const publishableKey = process.env.APP_CLERK_PUBLISHABLE_KEY?.trim();
const ownerEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

const hasClerkKeys = Boolean(secretKey && publishableKey);
const clerk = hasClerkKeys
  ? createClerkClient({ secretKey, publishableKey })
  : null;
const clerkIdentityCache = createAsyncTtlCache<{ email: string | null; verified: boolean }>(45_000, 1_000);
const defaultOwnerRecoveryCache = createAsyncTtlCache<boolean>(60_000, 100);
let missingAdminEmailWarningLogged = false;

export function warnIfAdminEmailMissing(
  adminEmail: string | null | undefined,
  warn: (message: string) => void = console.warn,
): boolean {
  if (adminEmail?.trim()) return false;
  warn("[auth-config] ADMIN_EMAIL is missing; owner access is disabled.");
  return true;
}

function warnMissingAdminEmailOnce(): void {
  if (ownerEmail || missingAdminEmailWarningLogged) return;
  missingAdminEmailWarningLogged = true;
  warnIfAdminEmailMissing(ownerEmail);
}

export type OwnerAuthStatus = {
  authConfigured: boolean;
  authenticated: boolean;
  isOwner: boolean;
  isPlatformAdmin: boolean;
  userId: string | null;
  email: string | null;
  businessId: string | null;
  businessName: string | null;
  role: BusinessRole | "platform_admin" | null;
  businesses: BusinessSummary[];
  permissions: FacilityPermissions;
  businessAccessAvailable?: boolean;
};

export function ownerAuthIsConfigured(): boolean {
  warnMissingAdminEmailOnce();
  return hasClerkKeys && Boolean(ownerEmail);
}

export async function getOwnerAuthStatus(req: Request): Promise<OwnerAuthStatus> {
  if (!ownerAuthIsConfigured() || !clerk) {
    return {
      authConfigured: false, authenticated: false, isOwner: false, isPlatformAdmin: false,
      userId: null, email: null, businessId: null, businessName: null, role: null,
      businesses: [], permissions: noPermissions(),
    };
  }

  const userId = getAuth(req).userId;
  if (!userId) {
    return {
      authConfigured: true, authenticated: false, isOwner: false, isPlatformAdmin: false,
      userId: null, email: null, businessId: null, businessName: null, role: null,
      businesses: [], permissions: noPermissions(),
    };
  }

  const identity = await clerkIdentityCache.get(userId, async () => {
    const user = await clerk.users.getUser(userId);
    const primaryEmail = user.primaryEmailAddress;
    const verified = primaryEmail?.verification?.status === "verified";
    return {
      email: verified ? primaryEmail.emailAddress.trim().toLowerCase() : null,
      verified,
    };
  });
  const email = identity.verified ? identity.email : null;
  const isPlatformAdmin = isVerifiedAdminIdentity(identity, ownerEmail);
  let businesses: BusinessSummary[] = [];
  let businessAccessAvailable = true;
  let businessId: string | null = null;
  let businessName: string | null = null;
  let role: BusinessRole | "platform_admin" | null = null;
  let isOwner = false;
  let permissions = noPermissions();

  if (email) {
    try {
      if (isPlatformAdmin) {
        await defaultOwnerRecoveryCache.get(userId, () =>
          restorePendingDefaultBusinessOwnership({ userId, verifiedEmail: email }),
        );
      }
      businesses = await listBusinessesForIdentity(userId, isPlatformAdmin);
      let selectedBusinessId = req.get("x-business-id")?.trim() || null;
      if (!selectedBusinessId) {
        selectedBusinessId = isPlatformAdmin
          ? DEFAULT_BUSINESS_ID
          : businesses.length === 1 ? businesses[0]!.id : null;
      }
      const selected = selectedBusinessId
        ? businesses.find((business) => business.id === selectedBusinessId) ?? null
        : null;
      businessId = selected?.id ?? null;
      businessName = selected?.name ?? null;
      role = selected?.role ?? null;
      isOwner = Boolean(businessId && (isPlatformAdmin || role === "owner"));
      permissions = isOwner
        ? ownerPermissions()
        : businessId
          ? await permissionsForEmail(email, businessId)
          : noPermissions();
    } catch (error) {
      // Clerk authentication and personal notebooks remain usable during a
      // business-registry outage. Never infer or grant facility access from
      // stale data or another database when the authoritative registry fails.
      const fallback = personalOnlyBusinessAccess(noPermissions());
      businessAccessAvailable = fallback.businessAccessAvailable;
      businesses = fallback.businesses;
      businessId = fallback.businessId;
      businessName = fallback.businessName;
      role = fallback.role;
      isOwner = fallback.isOwner;
      permissions = fallback.permissions;
      console.error(
        "[auth-status] Business access lookup failed; returning personal-only access.",
        error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error",
      );
    }
  }
  return {
    authConfigured: true, authenticated: true, isOwner, isPlatformAdmin, userId, email,
    businessId, businessName, role, businesses, permissions, businessAccessAvailable,
  };
}

function requestHasTrustedOrigin(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) {
    return req.get("sec-fetch-site") !== "cross-site";
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0].trim();
  const requestHost = forwardedHost || req.get("host");
  if (requestHost && originUrl.host.toLowerCase() === requestHost.toLowerCase()) {
    return true;
  }

  const allowedOrigins = (process.env.APP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return allowedOrigins.includes(originUrl.origin);
}

export async function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!requestHasTrustedOrigin(req)) {
    res.status(403).json({ error: "Yêu cầu không được gửi từ ứng dụng này." });
    return;
  }

  if (!ownerAuthIsConfigured() || !clerk) {
    res.status(503).json({ error: "Đăng nhập chủ sở hữu chưa được cấu hình." });
    return;
  }

  try {
    const status = await getOwnerAuthStatus(req);
    if (!status.authenticated) {
      res.status(401).json({ error: "Vui lòng đăng nhập để thực hiện thao tác này." });
      return;
    }
    if (!status.isOwner) {
      res.status(403).json({ error: "Tài khoản này chỉ có quyền xem." });
      return;
    }
    next();
  } catch (error) {
    req.log?.error({ err: error }, "Unable to verify owner account with Clerk");
    res.status(503).json({ error: "Không thể xác minh tài khoản chủ sở hữu." });
  }
}

export function isPublicEmployeeRead(req: Request): boolean {
  return (req.method === "GET" || req.method === "HEAD") && ["/healthz", "/auth/status"].includes(req.path);
}

/** Facility data routes must use the server-authenticated tenant, never a client-supplied or default tenant ID. */
export function currentFacilityBusinessId(res: Response): string {
  const status = res.locals.facilityAuth as OwnerAuthStatus | undefined;
  if (!status?.authenticated || !status.businessId) {
    throw new Error("Verified business scope is required for facility data.");
  }
  return status.businessId;
}

const positiveId = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value > 0
  ? value : typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 0;

export async function apiAuthorizationGate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  res.set("Cache-Control", "private, no-store");
  if (req.path === "/retention/cleanup") {
    if (req.method !== "GET") { res.status(405).json({ error: "Phương thức không được hỗ trợ." }); return; }
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) { res.status(503).json({ error: "Lịch lưu trữ chưa được cấu hình." }); return; }
    if (!isValidRetentionCronAuthorization(req.get("authorization"), secret)) {
      res.status(401).json({ error: "Không được phép chạy tác vụ lưu trữ." });
      return;
    }
    next();
    return;
  }
  if (req.method === "OPTIONS" || isPublicEmployeeRead(req)) { next(); return; }
  if (!requestHasTrustedOrigin(req)) {
    res.status(403).json({ error: "Yêu cầu không được gửi từ ứng dụng này." });
    return;
  }
  if (req.path === "/personal" || req.path.startsWith("/personal/")) {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Vui lòng đăng nhập để dùng sổ cá nhân." });
      return;
    }
    res.locals.personalUserId = userId;
    const needsComparisonPermission = req.path === "/personal/comparison" ||
      req.path === "/personal/sync" || req.path === "/personal/comparison/members";
    try {
      const status = await getOwnerAuthStatus(req);
      res.locals.facilityAuth = status;
      if (needsComparisonPermission) {
        if (status.businessAccessAvailable === false) {
          res.status(503).json({ error: "Quyền cơ sở chưa sẵn sàng để đối chiếu." });
          return;
        }
        if (req.path === "/personal/comparison/members") {
          if (!status.businessId || (!status.isOwner && !status.permissions.compareAllEmployees &&
              status.permissions.compareEmployeeIds.length === 0)) {
            res.status(403).json({ error: "Bạn chưa được cấp quyền chọn nhân viên để đối chiếu." });
            return;
          }
        } else {
          const id = positiveId(req.path === "/personal/sync" ? req.body?.memberId : req.query.memberId);
          if (!status.isOwner && !canCompareEmployee(status.permissions, id)) {
            res.status(403).json({ error: "Bạn chưa được cấp quyền đối chiếu nhân viên này." });
            return;
          }
          if (!status.businessId) {
            res.status(403).json({ error: "Hãy chọn cơ sở đã cấp quyền đối chiếu." });
            return;
          }
        }
      }
      next();
    } catch (error) {
      if (needsComparisonPermission) {
        req.log?.error({ err: error }, "Unable to verify comparison permissions");
        res.status(503).json({ error: "Không thể xác minh quyền đối chiếu." });
        return;
      }
      // The verified personal notebook stays usable during a business access
      // outage; no business ID is exposed to personal data operations.
      res.locals.facilityAuth = undefined;
      next();
    }
    return;
  }
  try {
    const status = await getOwnerAuthStatus(req);
    if (!status.authenticated) { res.status(401).json({ error: "Vui lòng đăng nhập để sử dụng dịch vụ." }); return; }
    res.locals.facilityAuth = status;
    if (req.path === "/businesses" || req.path === "/businesses/join" || /^\/businesses\/[0-9a-f-]{36}\/join-code$/i.test(req.path)) {
      if (!status.email || !status.userId) {
        res.status(403).json({ error: "Tài khoản cần có email đã xác minh để quản lý doanh nghiệp." });
        return;
      }
      next();
      return;
    }
    const leaveBusinessMatch = /^\/businesses\/([0-9a-f-]{36})\/leave$/i.exec(req.path);
    if (req.method === "DELETE" && leaveBusinessMatch) {
      if (!status.userId || !status.email) {
        res.status(403).json({ error: "Tài khoản cần có email đã xác minh để rời cơ sở." });
        return;
      }
      if (status.isOwner || status.role === "owner") {
        res.status(409).json({ error: "Chủ cơ sở cần chuyển quyền sở hữu trước khi rời cơ sở." });
        return;
      }
      if (status.isPlatformAdmin || status.role !== "employee") {
        res.status(403).json({ error: "Chỉ nhân viên của cơ sở mới được rời cơ sở." });
        return;
      }
      if (status.businessId !== leaveBusinessMatch[1]) {
        res.status(403).json({ error: "Chỉ có thể rời cơ sở đang chọn." });
        return;
      }
      next();
      return;
    }
    if (!status.businessId) {
      res.status(409).json({ error: "Hãy chọn hoặc tham gia một doanh nghiệp trước khi mở dữ liệu cơ sở." });
      return;
    }
    if (status.isOwner) { next(); return; }
    if (await managerRequestAllowed(req, status.permissions, status.businessId)) { next(); return; }
    res.status(403).json({ error: "Tài khoản chưa được cấp quyền thực hiện thao tác này." });
  } catch (error) {
    if (error instanceof DatabaseFailoverInProgressError) {
      res.status(503).json({ error: "Đang chuyển database, vui lòng thử lại." });
      return;
    }
    req.log?.error({ err: error }, "Unable to verify facility permissions");
    res.status(503).json({ error: "Không thể xác minh quyền truy cập. Hãy thử lại." });
  }
}

/** Every unrecognized endpoint fails closed. Identity and grants never come from request bodies. */
export async function managerRequestAllowed(
  req: Request,
  p: FacilityPermissions,
  businessId = DEFAULT_BUSINESS_ID,
): Promise<boolean> {
  const read = req.method === "GET" || req.method === "HEAD";
  const path = req.path;
  if (read) {
    if (path === "/appointments") return p.viewAppointments;
    if (path === "/appointments/staff-activity") return p.viewAppointments;
    if (path === "/access-grants") return hasGrantManagementAccess(p);
    if (path === "/members" || path === "/history-months" || path === "/attendance" || path === "/attendance/summary") return true; // rows filtered at source
    if (path === "/massage-summary" || path === "/payment-details") return p.viewRevenue;
    if (path === "/service-types") return p.allEmployees || p.employeeIds.length > 0 || p.viewCards || p.editServices;
    if (path === "/member-payroll") return canViewEmployee(p, positiveId(req.query.memberId));
    if (path === "/service-sessions") {
      if (req.query.cardId !== undefined) return positiveId(req.query.cardId) > 0 && p.viewCards;
      if (req.query.memberId !== undefined) return canViewEmployee(p, positiveId(req.query.memberId));
      return p.allEmployees || p.employeeIds.length > 0;
    }
    if (/^\/treatment-cards(?:\/[1-9]\d*(?:\/hours)?)?$/.test(path)) return p.viewCards;
    return false;
  }
  if (path === "/access-grants" && req.method === "POST") return hasGrantManagementAccess(p);
  if (/^\/access-grants\/[1-9]\d*$/.test(path) && req.method === "DELETE") return hasGrantManagementAccess(p);
  if (path === "/appointments" && req.method === "POST") return p.editAppointments && p.viewAppointments;
  if (/^\/appointments\/staff-activity\/[1-9]\d*$/.test(path) && req.method === "PATCH") {
    return p.editAppointments && p.viewAppointments;
  }
  if (/^\/appointments\/[1-9]\d*$/.test(path) && ["PATCH", "DELETE"].includes(req.method)) {
    return p.editAppointments && p.viewAppointments;
  }
  if (path === "/members" && req.method === "POST") return p.allEmployees && p.editEmployees;
  if (/^\/members\/[1-9]\d*$/.test(path) && req.method === "PATCH") return canEditEmployee(p, positiveId(path.split("/")[2]));
  if (/^\/members\/[1-9]\d*$/.test(path) && req.method === "DELETE") return canDeleteEmployee(p, positiveId(path.split("/")[2]));
  if (/^\/service-types(?:\/[1-9]\d*)?$/.test(path)) return p.editServices && ["POST", "PATCH", "DELETE"].includes(req.method);
  if (/^\/treatment-cards(?:\/[1-9]\d*(?:\/hours)?)?$/.test(path)) return p.viewCards && p.editCards && ["POST", "PATCH", "DELETE"].includes(req.method);
  const sessionId = /^\/service-sessions\/([1-9]\d*)$/.exec(path);
  if (path === "/service-sessions" || sessionId) {
    if (!["POST", "PATCH", "DELETE"].includes(req.method) || !p.editEmployees) return false;
    if (sessionId) {
      const old = isPartitionedStorageEnabled()
        ? await readPartitionedRowById<typeof serviceSessionsTable.$inferSelect>("service_sessions", positiveId(sessionId[1]), businessId)
        : (await db.select().from(serviceSessionsTable).where(and(
          eq(serviceSessionsTable.id, positiveId(sessionId[1])),
          eq(serviceSessionsTable.businessId, businessId),
        )).limit(1))[0];
      if (!old || !(old.memberId === null && req.method === "DELETE" ? p.allEmployees : canEditEmployee(p, old.memberId ?? 0))
        || (old.cardId !== null && !(p.viewCards && p.editCards))) return false;
      if (req.method === "DELETE") return true;
    } else if (req.method !== "POST") return false;
    return canEditEmployee(p, positiveId(req.body?.memberId)) && (req.body?.cardId == null || (p.viewCards && p.editCards));
  }
  const attendanceId = /^\/attendance\/([1-9]\d*)$/.exec(path);
  if (path === "/attendance" || attendanceId) {
    if (!["POST", "PATCH", "DELETE"].includes(req.method) || !p.editEmployees) return false;
    if (attendanceId) {
      const old = isPartitionedStorageEnabled()
        ? await readPartitionedRowById<typeof attendanceTable.$inferSelect>("attendance", positiveId(attendanceId[1]), businessId)
        : (await db.select().from(attendanceTable).where(and(
          eq(attendanceTable.id, positiveId(attendanceId[1])),
          eq(attendanceTable.businessId, businessId),
        )).limit(1))[0];
      if (!old || !canEditEmployee(p, old.memberId ?? 0)) return false;
      if (req.method === "DELETE") return true;
      if (!Object.hasOwn(req.body ?? {}, "memberId")) return true;
    } else if (req.method !== "POST") return false;
    return canEditEmployee(p, positiveId(req.body?.memberId));
  }
  return false;
}

function hasGrantManagementAccess(p: FacilityPermissions): boolean {
  return p.allEmployees || p.employeeIds.length > 0 || p.viewCards || p.viewRevenue ||
    p.editServices || p.viewAppointments || p.editAppointments;
}
