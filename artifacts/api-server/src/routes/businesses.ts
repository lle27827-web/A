import { Router, type IRouter, type Response } from "express";
import {
  CreateBusinessBody,
  CreateBusinessResponse,
  JoinBusinessBody,
  JoinBusinessResponse,
  LeaveBusinessParams,
  RotateBusinessJoinCodeResponse,
} from "@workspace/api-zod";
import { createBusinessForOwner, joinBusinessByCode, rotateBusinessJoinCode } from "../lib/business-tenancy";
import { BusinessLeaveError, leaveBusinessForEmployee } from "../lib/business-leave";
import { operationIdFromRequest } from "../lib/partitioned-mutations";
import type { OwnerAuthStatus } from "../lib/owner-auth";

const router: IRouter = Router();

function currentStatus(res: Response): OwnerAuthStatus | undefined {
  return res.locals.facilityAuth as OwnerAuthStatus | undefined;
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
    const business = await joinBusinessByCode({
      userId: status.userId,
      email: status.email,
      code: parsed.data.code,
    });
    if (!business) {
      res.status(400).json({ error: "Tên cơ sở hoặc mã doanh nghiệp không đúng." });
      return;
    }
    res.json(JoinBusinessResponse.parse({ business, joinCode: null }));
  } catch (error) {
    req.log?.error({ err: error }, "Unable to join business");
    res.status(503).json({ error: "Không thể tham gia doanh nghiệp. Hãy thử lại." });
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
