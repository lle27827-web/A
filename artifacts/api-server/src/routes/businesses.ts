import { Router, type IRouter, type Response } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import {
  GetCurrentBusinessPrintProfileResponse,
  CreateBusinessBody,
  CreateBusinessResponse,
  JoinBusinessBody,
  JoinBusinessResponse,
  ListCurrentBusinessMembersResponse,
  LeaveBusinessParams,
  RotateBusinessJoinCodeResponse,
  UpdateCurrentBusinessPrintProfileBody,
  UpdateCurrentBusinessPrintProfileResponse,
} from "@workspace/api-zod";
import {
  BusinessCreationLimitError,
  createBusinessForOwner,
  getBusinessPrintProfile,
  joinBusinessByCode,
  listCurrentBusinessMembers,
  rotateBusinessJoinCode,
  updateBusinessPrintProfile,
} from "../lib/business-tenancy";
import { BusinessLeaveError, leaveBusinessForEmployee } from "../lib/business-leave";
import { operationIdFromRequest } from "../lib/partitioned-mutations";
import { requireOwner, type OwnerAuthStatus } from "../lib/owner-auth";

const router: IRouter = Router();

function currentStatus(res: Response): OwnerAuthStatus | undefined {
  return res.locals.facilityAuth as OwnerAuthStatus | undefined;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

router.post("/businesses", async (req, res): Promise<void> => {
  const status = currentStatus(res);
  const parsed = CreateBusinessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!status?.userId || !status.email) {
    res.status(401).json({ error: "Vui lòng đăng nhập bằng email đã xác minh." });
    return;
  }
  try {
    const created = await createBusinessForOwner({
      userId: status.userId,
      email: status.email,
      name: parsed.data.name,
    });
    res.status(201).json(CreateBusinessResponse.parse({
      business: created.business,
      joinCode: created.joinCode,
    }));
  } catch (error) {
    if (error instanceof BusinessCreationLimitError) {
      res.status(429).json({ error: error.message });
      return;
    }
    req.log?.error({ err: error }, "Unable to create business");
    res.status(503).json({ error: error instanceof Error ? error.message : "Không thể tạo doanh nghiệp." });
  }
});

router.post("/businesses/join", async (req, res): Promise<void> => {
  const status = currentStatus(res);
  const parsed = JoinBusinessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Mã doanh nghiệp phải gồm đúng 10 chữ số." });
    return;
  }
  if (!status?.userId || !status.email) {
    res.status(401).json({ error: "Vui lòng đăng nhập bằng email đã xác minh." });
    return;
  }
  try {
    const result = await joinBusinessByCode({
      userId: status.userId,
      email: status.email,
      code: parsed.data.code,
      ipAddress: req.ip || req.socket.remoteAddress
        ? ipKeyGenerator(req.ip || req.socket.remoteAddress!)
        : "unknown",
    });
    if (result.kind === "rate-limited") {
      res.set("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json({
        error: "Bạn đã nhập sai mã quá nhiều lần. Hãy thử lại sau 15 phút.",
      });
      return;
    }
    if (result.kind === "invalid-code") {
      res.status(400).json({
        error: "Mã tham gia không đúng. Hãy kiểm tra đủ 10 chữ số hoặc hỏi lại chủ cơ sở.",
      });
      return;
    }
    res.json(JoinBusinessResponse.parse({ business: result.business, joinCode: null }));
  } catch (error) {
    req.log?.error({ err: error }, "Unable to join business");
    res.status(503).json({ error: "Không thể tham gia doanh nghiệp. Hãy thử lại." });
  }
});

router.get("/businesses/current/members", async (req, res): Promise<void> => {
  const status = currentStatus(res);
  if (!status?.authenticated || !status.userId) {
    res.status(401).json({ error: "Vui lòng đăng nhập." });
    return;
  }
  if (!status.businessId) {
    res.status(409).json({ error: "Hãy chọn cơ sở trước khi xem thành viên." });
    return;
  }
  if (!status.isOwner) {
    res.status(403).json({ error: "Chỉ chủ cơ sở được xem danh sách tài khoản đã tham gia." });
    return;
  }

  try {
    const accounts = await listCurrentBusinessMembers({
      businessId: status.businessId,
      ownerUserId: status.userId,
      isPlatformAdmin: status.isPlatformAdmin,
    });
    res.json(ListCurrentBusinessMembersResponse.parse(accounts));
  } catch (error) {
    req.log?.error({ err: error, businessId: status.businessId }, "Unable to list business members");
    res.status(503).json({ error: "Không thể tải danh sách tài khoản đã tham gia cơ sở." });
  }
});

router.get("/businesses/current/print-profile", async (req, res): Promise<void> => {
  const status = currentStatus(res);
  if (!status?.authenticated) {
    res.status(401).json({ error: "Vui lòng đăng nhập." });
    return;
  }
  if (!status.businessId) {
    res.status(409).json({ error: "Hãy chọn cơ sở trước khi xem thông tin in." });
    return;
  }

  res.set("Cache-Control", "private, no-store");
  try {
    const profile = await getBusinessPrintProfile(status.businessId);
    if (!profile) {
      res.status(404).json({ error: "Không tìm thấy thông tin của cơ sở đang chọn." });
      return;
    }
    res.json(GetCurrentBusinessPrintProfileResponse.parse(profile));
  } catch (error) {
    req.log?.error({ errorName: safeErrorName(error), businessId: status.businessId }, "Unable to read business print profile");
    res.status(503).json({ error: "Không thể tải thông tin in của cơ sở." });
  }
});

router.patch("/businesses/current/print-profile", requireOwner, async (req, res): Promise<void> => {
  const status = currentStatus(res);
  const parsed = UpdateCurrentBusinessPrintProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!status?.userId || !status.businessId || !status.isOwner) {
    res.status(403).json({ error: "Chỉ chủ sở hữu của cơ sở đang chọn mới được sửa thông tin in." });
    return;
  }

  try {
    const profile = await updateBusinessPrintProfile({
      businessId: status.businessId,
      ownerUserId: status.userId,
      profile: parsed.data,
    });
    if (!profile) {
      res.status(404).json({ error: "Không tìm thấy cơ sở thuộc quyền sở hữu của tài khoản này." });
      return;
    }
    res.set("Cache-Control", "private, no-store");
    res.json(UpdateCurrentBusinessPrintProfileResponse.parse(profile));
  } catch (error) {
    req.log?.error({ errorName: safeErrorName(error), businessId: status.businessId }, "Unable to update business print profile");
    res.status(503).json({ error: "Không thể lưu thông tin in của cơ sở." });
  }
});

router.delete("/businesses/:id/leave", async (req, res): Promise<void> => {
  const status = currentStatus(res);
  const params = LeaveBusinessParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!status?.userId || !status.email) {
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
  if (status.businessId !== params.data.id) {
    res.status(403).json({ error: "Chỉ có thể rời cơ sở đang chọn." });
    return;
  }
  try {
    await leaveBusinessForEmployee({
      businessId: params.data.id,
      selectedBusinessId: status.businessId,
      userId: status.userId,
      email: status.email,
      role: status.role,
      isOwner: status.isOwner,
      isPlatformAdmin: status.isPlatformAdmin,
      operationId: operationIdFromRequest(req.get("Idempotency-Key"), "rời cơ sở"),
    });
    res.sendStatus(204);
  } catch (error) {
    if (error instanceof BusinessLeaveError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    req.log?.error({ err: error, businessId: params.data.id }, "Unable to leave business");
    res.status(503).json({ error: "Chưa thể hoàn tất việc rời cơ sở. Hãy thử lại." });
  }
});

router.post("/businesses/:id/join-code", async (req, res): Promise<void> => {
  const status = currentStatus(res);
  const businessId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ownedBusiness = status?.businesses.find((business) =>
    business.id === businessId && business.role === "owner",
  );
  if (!status?.userId || !ownedBusiness) {
    res.status(403).json({ error: "Chỉ chủ sở hữu của cơ sở này mới được đổi mã tham gia." });
    return;
  }
  try {
    const joinCode = await rotateBusinessJoinCode({
      businessId,
      ownerUserId: status.userId,
    });
    if (!joinCode) {
      res.status(403).json({ error: "Không thể xác minh quyền chủ doanh nghiệp." });
      return;
    }
    res.json(RotateBusinessJoinCodeResponse.parse({
      business: {
        id: ownedBusiness.id,
        name: ownedBusiness.name,
        role: "owner",
      },
      joinCode,
    }));
  } catch (error) {
    req.log?.error({ err: error }, "Unable to rotate business join code");
    res.status(503).json({ error: "Không thể tạo mã tham gia mới." });
  }
});

export default router;
