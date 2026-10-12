import { clerkClient, getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";

export type AccessStatus = {
  signedIn: boolean;
  isOwner: boolean;
  ownerConfigured: boolean;
};

export async function getAccessStatus(req: Request): Promise<AccessStatus> {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const userId = getAuth(req).userId;
  const ownerConfigured = Boolean(ownerEmail);

  if (!userId || !ownerEmail) {
    return { signedIn: Boolean(userId), isOwner: false, ownerConfigured };
  }

  const user = await clerkClient.users.getUser(userId);
  const isOwner = user.emailAddresses.some(
    (email) =>
      email.verification?.status === "verified" &&
      email.emailAddress.trim().toLowerCase() === ownerEmail,
  );

  return { signedIn: true, isOwner, ownerConfigured: true };
}

export const requireOwner: RequestHandler = async (req, res, next): Promise<void> => {
  const status = await getAccessStatus(req);

  if (!status.ownerConfigured) {
    res.status(403).json({
      error: "Quyền chỉnh sửa chưa được cấu hình cho chủ sở hữu.",
    });
    return;
  }

  if (!status.signedIn) {
    res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
    return;
  }

  if (!status.isOwner) {
    res.status(403).json({ error: "Chỉ chủ sở hữu mới được thay đổi dữ liệu." });
    return;
  }

  next();
};
