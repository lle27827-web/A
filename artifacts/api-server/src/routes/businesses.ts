import { Router, type IRouter, type Response } from "express";
import {
  CreateBusinessBody,
  CreateBusinessResponse,
  JoinBusinessBody,
  JoinBusinessResponse,
  RotateBusinessJoinCodeResponse,
} from "@workspace/api-zod";
import { createBusinessForOwner, joinBusinessByCode, rotateBusinessJoinCode } from "../lib/business-tenancy";
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
      res.status(400).json({ error: "Mã doanh nghiệp không đúng hoặc đã bị thay đổi." });
      return;
    }
    res.json(JoinBusinessResponse.parse({ business, joinCode: null }));
  } catch (error) {
    req.log?.error({ err: error }, "Unable to join business");
    res.status(503).json({ error: "Không thể tham gia doanh nghiệp. Hãy thử lại." });
  }
});

router.post("/businesses/:id/join-code", async (req, res): Promise<void> => {
  const status = currentStatus(res);
  const businessId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!status?.userId || status.role !== "owner" || status.businessId !== businessId) {
    res.status(403).json({ error: "Chỉ chủ doanh nghiệp đang chọn mới được đổi mã tham gia." });
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
        id: status.businessId,
        name: status.businessName,
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
