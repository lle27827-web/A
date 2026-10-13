import { clerkClient, getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";
import { inArray } from "drizzle-orm";
import { db, managerGrantsTable } from "@workspace/db";
import { canViewMemberManagement, resolvePermissions, verifiedAccountEmails } from "../lib/permissions";

export type AccessStatus = {
  signedIn: boolean;
  isOwner: boolean;
  canManage: boolean;
  ownerConfigured: boolean;
};

const requestAccess = new WeakMap<Request, Promise<AccessStatus>>();
export function getAccessStatus(req: Request): Promise<AccessStatus> {
  const existing = requestAccess.get(req);
  if (existing) return existing;
  const pending = resolveRequestAccess(req);
  requestAccess.set(req, pending);
  return pending;
}

async function resolveRequestAccess(req: Request): Promise<AccessStatus> {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const userId = getAuth(req).userId;
  const ownerConfigured = Boolean(ownerEmail);

  if (!userId || !ownerEmail) {
    return { signedIn: Boolean(userId), isOwner: false, canManage: false, ownerConfigured };
  }

  const user = await clerkClient.users.getUser(userId);
  const emails = verifiedAccountEmails(user.emailAddresses);
  const primary = resolvePermissions(ownerEmail, emails, []);
  if (primary.isOwner || emails.length === 0) return { signedIn: true, ...primary };
  const grants = await db.select({ email: managerGrantsTable.email }).from(managerGrantsTable)
    .where(inArray(managerGrantsTable.email, emails)).limit(1);
  return { signedIn: true, ...resolvePermissions(ownerEmail, emails, grants.map((g) => g.email)) };
}

function authorize(ownerOnly: boolean): RequestHandler {
  return async (req, res, next): Promise<void> => {
    let status: AccessStatus;
    try {
      status = await getAccessStatus(req);
    } catch {
      res.status(503).json({ error: "Không thể xác minh tài khoản. Vui lòng thử lại." });
      return;
    }
    res.set("Cache-Control", "private, no-store");
    if (!status.ownerConfigured) {
      res.status(403).json({ error: "Quyền chỉnh sửa chưa được cấu hình cho chủ sở hữu." });
      return;
    }
    if (!status.signedIn) {
      res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
      return;
    }
    if (ownerOnly ? !status.isOwner : !status.canManage) {
      res.status(403).json({
        error: ownerOnly ? "Chỉ chủ sở hữu mới được quản lý việc cấp và thu hồi quyền."
          : "Chỉ chủ sở hữu hoặc người được cấp quyền quản lý mới được xem và thay đổi dữ liệu.",
      });
      return;
    }
    next();
  };
}

export const requireSignedIn: RequestHandler = async (req, res, next): Promise<void> => {
  let status: AccessStatus;
  try {
    status = await getAccessStatus(req);
  } catch {
    res.status(503).json({ error: "Không thể xác minh tài khoản. Vui lòng thử lại." });
    return;
  }
  res.set("Cache-Control", "private, no-store");
  if (!canViewMemberManagement(status.signedIn)) {
    res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
    return;
  }
  next();
};

export const requireOwner = authorize(true);
export const requireEditor = authorize(false);
