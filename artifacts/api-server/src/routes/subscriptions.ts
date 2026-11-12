import express, { Router, type IRouter, type Response } from "express";
import {
  CreateSubscriptionPaymentRequestBody,
  CreateSubscriptionPaymentRequestResponse,
  GetSubscriptionStatusResponse,
  ListMySubscriptionPaymentRequestsResponse,
  ListPlatformBillingAccountsResponse,
  GetPlatformBillingSettingsResponse,
  UpdatePlatformBillingSettingsBody,
  UpdatePlatformBillingSettingsResponse,
  RenewPlatformSubscriptionBody,
  UpdatePlatformPersonalAccessParams,
  UpdatePlatformPersonalAccessBody,
  UpdatePlatformBusinessAccessParams,
  UpdatePlatformBusinessAccessBody,
  ReviewPlatformPaymentRequestParams,
  ReviewPlatformPaymentRequestBody,
  ListPlatformPaymentRequestsResponse,
} from "@workspace/api-zod";
import {
  createSubscriptionPaymentRequest,
  getPlatformBillingSettings,
  getPlatformPaymentQr,
  getSubscriptionStatus,
  listMySubscriptionPaymentRequests,
  listPlatformBillingAccounts,
  listPlatformPaymentRequests,
  renewPlatformSubscription,
  reviewSubscriptionPaymentRequest,
  savePlatformPaymentQr,
  SubscriptionBillingError,
  updatePlatformBillingSettings,
  updatePlatformBusinessAccess,
  updatePlatformPersonalAccess,
} from "../lib/subscription-billing";
import { requirePlatformAdmin, type OwnerAuthStatus } from "../lib/owner-auth";

const router: IRouter = Router();
const qrUploadLimit = 1024 * 1024;

function statusFrom(res: Response): OwnerAuthStatus | null {
  return (res.locals.facilityAuth as OwnerAuthStatus | undefined) ?? null;
}

function sendBillingError(res: Response, error: unknown, fallback: string) {
  if (error instanceof SubscriptionBillingError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(503).json({ error: fallback });
}

function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

function parseOffset(value: unknown): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : 0;
}

router.get("/subscriptions/status", async (req, res): Promise<void> => {
  const status = statusFrom(res);
  if (!status?.authenticated || !status.userId) {
    res.status(401).json({ error: "Vui lòng đăng nhập để xem gói dịch vụ." });
    return;
  }
  try {
    const response = await getSubscriptionStatus({
      userId: status.userId,
      hasVerifiedEmail: Boolean(status.email),
      businessId: status.businessId,
      isPlatformAdmin: status.isPlatformAdmin,
    });
    res.json(GetSubscriptionStatusResponse.parse(response));
  } catch (error) {
    req.log?.error({ err: error }, "Unable to read subscription status");
    sendBillingError(res, error, "Chưa thể kiểm tra gói dịch vụ. Vui lòng thử lại.");
  }
});

router.get("/subscriptions/qr", async (req, res): Promise<void> => {
  if (!statusFrom(res)?.authenticated) {
    res.status(401).json({ error: "Vui lòng đăng nhập để xem mã thanh toán." });
    return;
  }
  try {
    const qr = await getPlatformPaymentQr();
    res.set({
      "Content-Type": qr.contentType,
      "Content-Length": String(qr.image.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    }).status(200).send(qr.image);
  } catch (error) {
    sendBillingError(res, error, "Chưa thể tải mã QR thanh toán.");
  }
});

router.get("/subscriptions/payment-requests", async (_req, res): Promise<void> => {
  const status = statusFrom(res);
  if (!status?.authenticated || !status.userId) {
    res.status(401).json({ error: "Vui lòng đăng nhập." });
    return;
  }
  try {
    const requests = await listMySubscriptionPaymentRequests(status.userId);
    res.json(ListMySubscriptionPaymentRequestsResponse.parse(requests));
  } catch (error) {
    sendBillingError(res, error, "Chưa thể tải yêu cầu thanh toán.");
  }
});

router.post("/subscriptions/payment-requests", async (req, res): Promise<void> => {
  const status = statusFrom(res);
  const parsed = CreateSubscriptionPaymentRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Thông tin gói thanh toán không hợp lệ." });
    return;
  }
  if (!status?.authenticated || !status.userId || !status.email) {
    res.status(403).json({ error: "Cần đăng nhập bằng email đã xác minh để yêu cầu thanh toán." });
    return;
  }
  try {
    const request = await createSubscriptionPaymentRequest({
      userId: status.userId,
      product: parsed.data.product,
      months: parsed.data.months,
      businessId: parsed.data.businessId,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    res.status(201).json(CreateSubscriptionPaymentRequestResponse.parse(request));
  } catch (error) {
    sendBillingError(res, error, "Chưa thể tạo yêu cầu thanh toán.");
  }
});

router.get("/platform/billing", requirePlatformAdmin, async (req, res): Promise<void> => {
  try {
    const settings = await getPlatformBillingSettings();
    res.json(GetPlatformBillingSettingsResponse.parse(settings));
  } catch (error) {
    req.log?.error({ err: error }, "Unable to read platform billing settings");
    sendBillingError(res, error, "Chưa thể tải cấu hình thanh toán.");
  }
});

router.patch("/platform/billing", requirePlatformAdmin, async (req, res): Promise<void> => {
  const parsed = UpdatePlatformBillingSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Cần chọn ít nhất một công tắc phí hợp lệ." });
    return;
  }
  const actor = statusFrom(res)?.userId;
  if (!actor) {
    res.status(401).json({ error: "Vui lòng đăng nhập lại." });
    return;
  }
  try {
    const settings = await updatePlatformBillingSettings(actor, parsed.data);
    res.json(UpdatePlatformBillingSettingsResponse.parse(settings));
  } catch (error) {
    req.log?.error({ err: error }, "Unable to update platform billing settings");
    sendBillingError(res, error, "Chưa thể lưu cấu hình thanh toán.");
  }
});

router.put(
  "/platform/billing/qr",
  requirePlatformAdmin,
  express.raw({
    type: ["image/png", "image/jpeg", "image/webp"],
    limit: qrUploadLimit,
  }),
  (req, res, next) => {
    const contentType = req.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp"].includes(contentType ?? "")) {
      res.status(400).json({ error: "Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP." });
      return;
    }
    next();
  },
  // The QR is small and stored in DB3 so Vercel can serve it without Replit
  // sidecar credentials.
  async (req, res): Promise<void> => {
    const actor = statusFrom(res)?.userId;
    if (!actor) {
      res.status(401).json({ error: "Vui lòng đăng nhập lại." });
      return;
    }
    const image = Buffer.isBuffer(req.body) ? req.body : null;
    if (!image || image.length < 1 || image.length > qrUploadLimit) {
      res.status(400).json({ error: "Ảnh QR không hợp lệ hoặc vượt quá 1 MB." });
      return;
    }
    const contentType = req.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    try {
      await savePlatformPaymentQr(actor, image, contentType);
      res.sendStatus(204);
    } catch (error) {
      sendBillingError(res, error, "Chưa thể lưu mã QR.");
    }
  },
);

router.get("/platform/billing/accounts", requirePlatformAdmin, async (req, res): Promise<void> => {
  const query = typeof req.query.query === "string" ? req.query.query.trim().slice(0, 120) : undefined;
  const limit = parsePositiveInteger(req.query.limit, 50, 100);
  const offset = parseOffset(req.query.offset);
  try {
    const result = await listPlatformBillingAccounts({ query, limit, offset });
    res.json(ListPlatformBillingAccountsResponse.parse(result));
  } catch (error) {
    req.log?.error({ err: error }, "Unable to list platform billing accounts");
    sendBillingError(res, error, "Chưa thể tải danh sách tài khoản.");
  }
});

router.patch(
  "/platform/billing/accounts/:userId/personal-access",
  requirePlatformAdmin,
  async (req, res): Promise<void> => {
    const params = UpdatePlatformPersonalAccessParams.safeParse(req.params);
    const body = UpdatePlatformPersonalAccessBody.safeParse(req.body);
    const actor = statusFrom(res)?.userId;
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Thông tin quyền cá nhân không hợp lệ." });
      return;
    }
    if (!actor) {
      res.status(401).json({ error: "Vui lòng đăng nhập lại." });
      return;
    }
    try {
      await updatePlatformPersonalAccess(actor, params.data.userId, body.data.allowed);
      res.sendStatus(204);
    } catch (error) {
      req.log?.error({ err: error }, "Unable to update personal app access");
      sendBillingError(res, error, "Chưa thể cập nhật quyền cá nhân.");
    }
  },
);

router.patch(
  "/platform/billing/businesses/:businessId/access",
  requirePlatformAdmin,
  async (req, res): Promise<void> => {
    const params = UpdatePlatformBusinessAccessParams.safeParse(req.params);
    const body = UpdatePlatformBusinessAccessBody.safeParse(req.body);
    const actor = statusFrom(res)?.userId;
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Thông tin quyền cơ sở không hợp lệ." });
      return;
    }
    if (!actor) {
      res.status(401).json({ error: "Vui lòng đăng nhập lại." });
      return;
    }
    try {
      await updatePlatformBusinessAccess(actor, params.data.businessId, body.data.allowed);
      res.sendStatus(204);
    } catch (error) {
      req.log?.error({ err: error }, "Unable to update business app access");
      sendBillingError(res, error, "Chưa thể cập nhật quyền cơ sở.");
    }
  },
);

router.post("/platform/billing/renewals", requirePlatformAdmin, async (req, res): Promise<void> => {
  const parsed = RenewPlatformSubscriptionBody.safeParse(req.body);
  const actor = statusFrom(res)?.userId;
  if (!parsed.success || !actor) {
    res.status(actor ? 400 : 401).json({ error: "Thông tin gia hạn không hợp lệ." });
    return;
  }
  try {
    await renewPlatformSubscription(actor, parsed.data);
    res.sendStatus(204);
  } catch (error) {
    sendBillingError(res, error, "Chưa thể gia hạn gói.");
  }
});

router.get("/platform/billing/payment-requests", requirePlatformAdmin, async (req, res): Promise<void> => {
  const status = req.query.status;
  if (status !== undefined && status !== "pending" && status !== "approved" && status !== "rejected") {
    res.status(400).json({ error: "Trạng thái yêu cầu không hợp lệ." });
    return;
  }
  try {
    const requests = await listPlatformPaymentRequests(status as "pending" | "approved" | "rejected" | undefined);
    res.json(ListPlatformPaymentRequestsResponse.parse(requests));
  } catch (error) {
    sendBillingError(res, error, "Chưa thể tải yêu cầu thanh toán.");
  }
});

router.patch(
  "/platform/billing/payment-requests/:requestId",
  requirePlatformAdmin,
  async (req, res): Promise<void> => {
    const params = ReviewPlatformPaymentRequestParams.safeParse(req.params);
    const body = ReviewPlatformPaymentRequestBody.safeParse(req.body);
    const actor = statusFrom(res)?.userId;
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Thông tin xác nhận thanh toán không hợp lệ." });
      return;
    }
    if (!actor) {
      res.status(401).json({ error: "Vui lòng đăng nhập lại." });
      return;
    }
    try {
      await reviewSubscriptionPaymentRequest(actor, params.data.requestId, body.data.decision);
      res.sendStatus(204);
    } catch (error) {
      sendBillingError(res, error, "Chưa thể xử lý yêu cầu thanh toán.");
    }
  },
);

export default router;
