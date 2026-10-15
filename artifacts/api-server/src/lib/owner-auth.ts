import { createClerkClient } from "@clerk/backend";
import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

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
};

export function ownerAuthIsConfigured(): boolean {
  return hasClerkKeys && Boolean(ownerEmail);
}

export async function getOwnerAuthStatus(req: Request): Promise<OwnerAuthStatus> {
  if (!ownerAuthIsConfigured() || !clerk) {
    return { authConfigured: false, authenticated: false, isOwner: false };
  }

  const userId = getAuth(req).userId;
  if (!userId) {
    return { authConfigured: true, authenticated: false, isOwner: false };
  }

  const user = await clerk.users.getUser(userId);
  const primaryEmail = user.primaryEmailAddress;
  const isOwner = Boolean(
    primaryEmail &&
    primaryEmail.verification?.status === "verified" &&
    primaryEmail.emailAddress.trim().toLowerCase() === ownerEmail,
  );

  return { authConfigured: true, authenticated: true, isOwner };
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

function hasQueryValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPublicEmployeeRead(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (req.path === "/healthz" || req.path === "/auth/status") return true;
  if (["/members", "/attendance", "/attendance/summary"].includes(req.path)) return true;

  if (req.path === "/member-payroll") {
    return hasQueryValue(req.query.memberId);
  }

  if (req.path === "/service-sessions") {
    return hasQueryValue(req.query.memberId) && !hasQueryValue(req.query.cardId);
  }

  return false;
}

export function apiAuthorizationGate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method === "OPTIONS" || isPublicEmployeeRead(req)) {
    next();
    return;
  }
  void requireOwner(req, res, next);
}
