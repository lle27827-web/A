import express, { type Express } from "express";
import { clerkMiddleware } from "@clerk/express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiAuthorizationGate } from "./lib/owner-auth";
import { refreshDatabaseBackend } from "@workspace/db";

const app: Express = express();
app.set("trust proxy", 1);
const clerkSecretKey = process.env.APP_CLERK_SECRET_KEY?.trim();
const clerkPublishableKey = process.env.APP_CLERK_PUBLISHABLE_KEY?.trim();
const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => req.path === "/healthz",
});
const apiWriteRateLimit = rateLimit({
  windowMs: 5 * 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Bạn thao tác quá nhanh. Vui lòng thử lại sau." },
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(helmet());
app.use(express.json());

if (clerkSecretKey && clerkPublishableKey) {
  const clerkAuth = clerkMiddleware({
    secretKey: clerkSecretKey,
    publishableKey: clerkPublishableKey,
  });
  app.use((req, res, next) => req.path === "/api/retention/cleanup" ? next() : clerkAuth(req, res, next));
} else {
  logger.warn("External Clerk keys are not configured; API remains read-only");
}

app.use("/api", apiRateLimit);
app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return apiWriteRateLimit(req, res, next);
  }
  return next();
});

app.use("/api", apiAuthorizationGate);
app.use("/api", async (req, res, next) => {
  if (req.path === "/healthz") return next();
  try {
    const backend = await refreshDatabaseBackend();
    if (backend === "switching") {
      return res.status(503).json({
        message: "Đang chuyển database, vui lòng thử lại sau.",
      });
    }
    return next();
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : undefined;
    logger.error({ code }, "Database route check failed");
    return res.status(503).json({
      message: "Chưa thể xác nhận database đang hoạt động, vui lòng thử lại.",
    });
  }
});

app.use("/api", router);
app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  req.log?.error({ err: error, method: req.method, path: req.path }, "Unhandled API error");
  res.status(500).json({ message: "Đã xảy ra lỗi khi xử lý yêu cầu." });
});

export default app;
