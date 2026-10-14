import app from "./app";
import { logger } from "./lib/logger";

// Vercel runs the exported Express app as a serverless function and does not
// start this listener. Replit's managed service still needs its PORT listener.
export default app;

if (process.env.VERCEL !== "1") {
  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}
