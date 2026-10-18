import express, { type Express } from "express";
import { clerkMiddleware } from "@clerk/express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiAuthorizationGate } from "./lib/owner-auth";
import { refreshDatabaseBackend } from "@workspace/db";

const app: Express = express();
const clerkSecretKey = process.env.APP_CLERK_SECRET_KEY?.trim();
const clerkPublishableKey = process.env.APP_CLERK_PUBLISHABLE_KEY?.trim();

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (clerkSecretKey && clerkPublishableKey) {
  const clerkAuth = clerkMiddleware({
    secretKey: clerkSecretKey,
    publishableKey: clerkPublishableKey,
  });
  app.use((req, res, next) => req.path === "/api/retention/cleanup" ? next() : clerkAuth(req, res, next));
} else {
  logger.warn("External Clerk keys are not configured; API remains read-only");
}

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

app.use("/api", apiAuthorizationGate);
app.use("/api", router);

export default app;
