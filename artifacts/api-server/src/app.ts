import express, { type Express } from "express";
import { clerkMiddleware } from "@clerk/express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiAuthorizationGate } from "./lib/owner-auth";

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
  app.use(clerkMiddleware({
    secretKey: clerkSecretKey,
    publishableKey: clerkPublishableKey,
  }));
} else {
  logger.warn("External Clerk keys are not configured; API remains read-only");
}

app.use("/api", apiAuthorizationGate);
app.use("/api", router);

export default app;
