import { createClerkClient } from "@clerk/backend";
import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { db, attendanceTable, isPartitionedStorageEnabled, readPartitionedTable, serviceSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { FacilityPermissions } from "@workspace/api-zod";
import { canEditEmployee, canViewEmployee, noPermissions, ownerPermissions, permissionsForEmail } from "./facility-permissions";
import { isValidRetentionCronAuthorization } from "./retention-auth";

const secretKey = process.env.APP_CLERK_SECRET_KEY?.trim();
const publishableKey = process.env.APP_CLERK_PUBLISHABLE_KEY?.trim();
const ownerEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

const hasClerkKeys = Boolean(secretKey && publishableKey);
const clerk = hasClerkKeys
  ? createClerkClient({ secretKey, publishableKey })
  : null;

export type OwnerAuthStatus = {
  authConfigured: boolean;
  authenticated: boolean;
  isOwner: boolean;
  email: string | null;
  permissions: FacilityPermissions;
};

export function ownerAuthIsConfigured(): boolean {
  return hasClerkKeys && Boolean(ownerEmail);
}

export async function getOwnerAuthStatus(req: Request): Promise<OwnerAuthStatus> {
  if (!ownerAuthIsConfigured() || !clerk) {
    return { authConfigured: false, authenticated: false, isOwner: false, email: null, permissions: noPermissions() };
  }

  const userId = getAuth(req).userId;
  if (!userId) {
    return { authConfigured: true, authenticated: false, isOwner: false, email: null, permissions: noPermissions() };
  }

  const user = await clerk.users.getUser(userId);
  const primaryEmail = user.primaryEmailAddress;
  const isOwner = Boolean(
    primaryEmail &&
    primaryEmail.verification?.status === "verified" &&
    primaryEmail.emailAddress.trim().toLowerCase() === ownerEmail,
  );

  const email = primaryEmail?.verification?.status === "verified" ? primaryEmail.emailAddress.trim().toLowerCase() : null;
  const permissions = isOwner ? ownerPermissions() : email ? await permissionsForEmail(email) : noPermissions();
  return { authConfigured: true, authenticated: true, isOwner, email, permissions };
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
    try {
      const userId = getAuth(req).userId;
      if (!userId) {
        res.status(401).json({ error: "Vui lòng đăng nhập để dùng sổ cá nhân." });
        return;
      }
      res.locals.personalUserId = userId;
      if (req.path === "/personal/comparison" || req.path === "/personal/sync") {
        const status = await getOwnerAuthStatus(req);
        const id = positiveId(req.path === "/personal/sync" ? req.body?.memberId : req.query.memberId);
        if (!canViewEmployee(status.permissions, id)) {
          res.status(403).json({ error: "Bạn chưa được cấp quyền xem nhân viên này." });
          return;
        }
      }
      next();
    } catch {
      res.status(503).json({ error: "Không thể xác minh phiên đăng nhập." });
    }
    return;
  }
  try {
    const status = await getOwnerAuthStatus(req);
    if (!status.authenticated) { res.status(401).json({ error: "Vui lòng đăng nhập để sử dụng dịch vụ." }); return; }
    res.locals.facilityAuth = status;
    if (status.isOwner) { next(); return; }
    if (await managerRequestAllowed(req, status.permissions)) { next(); return; }
    res.status(403).json({ error: "Tài khoản chưa được cấp quyền thực hiện thao tác này." });
  } catch (error) {
    req.log?.error({ err: error }, "Unable to verify facility permissions");
    res.status(503).json({ error: "Không thể xác minh quyền truy cập. Hãy thử lại." });
  }
}

/** Every unrecognized endpoint fails closed. Identity and grants never come from request bodies. */
export async function managerRequestAllowed(req: Request, p: FacilityPermissions): Promise<boolean> {
  const read = req.method === "GET" || req.method === "HEAD";
  const path = req.path;
  if (read) {
    if (path === "/appointments") return p.viewAppointments;
    if (path === "/access-grants") return hasGrantManagementAccess(p);
    if (path === "/members" || path === "/history-months" || path === "/attendance" || path === "/attendance/summary") return true; // rows filtered at source
    if (path === "/massage-summary") return p.viewRevenue;
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
  if (/^\/appointments\/[1-9]\d*$/.test(path) && ["PATCH", "DELETE"].includes(req.method)) {
    return p.editAppointments && p.viewAppointments;
  }
  if (path === "/members" && req.method === "POST") return p.allEmployees && p.editEmployees;
  if (/^\/members\/[1-9]\d*$/.test(path) && ["PATCH", "DELETE"].includes(req.method)) return canEditEmployee(p, positiveId(path.split("/")[2]));
  if (/^\/service-types(?:\/[1-9]\d*)?$/.test(path)) return p.editServices && ["POST", "PATCH", "DELETE"].includes(req.method);
  if (/^\/treatment-cards(?:\/[1-9]\d*(?:\/hours)?)?$/.test(path)) return p.viewCards && p.editCards && ["POST", "PATCH", "DELETE"].includes(req.method);
  const sessionId = /^\/service-sessions\/([1-9]\d*)$/.exec(path);
  if (path === "/service-sessions" || sessionId) {
    if (!["POST", "PATCH", "DELETE"].includes(req.method) || !p.editEmployees) return false;
    if (sessionId) {
      const old = isPartitionedStorageEnabled()
        ? (await readPartitionedTable("service_sessions") as unknown as (typeof serviceSessionsTable.$inferSelect)[])
          .find((row) => row.id === positiveId(sessionId[1]))
        : (await db.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, positiveId(sessionId[1]))).limit(1))[0];
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
        ? (await readPartitionedTable("attendance") as unknown as (typeof attendanceTable.$inferSelect)[])
          .find((row) => row.id === positiveId(attendanceId[1]))
        : (await db.select().from(attendanceTable).where(eq(attendanceTable.id, positiveId(attendanceId[1]))).limit(1))[0];
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
