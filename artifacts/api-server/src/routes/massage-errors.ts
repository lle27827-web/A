import type { Request, RequestHandler, Response } from "express";
import { MassageError } from "../lib/massage";

export function parseInput<T>(schema: {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new MassageError(400, "Thông tin nhập không hợp lệ. Kiểm tra các trường và giới hạn số giờ, số tiền.");
  return parsed.data;
}

function safeDatabaseDiagnostics(error: unknown): {
  errorType: string;
  databaseCode?: string;
  databaseTable?: string;
  databaseColumn?: string;
  databaseConstraint?: string;
} {
  const details = getDatabaseErrorDetails(error);
  const identifier = (value: unknown) =>
    typeof value === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)
      ? value
      : undefined;
  const code = typeof details.code === "string" && /^[A-Z0-9_]{1,16}$/.test(details.code)
    ? details.code
    : undefined;

  return {
    errorType: error instanceof Error ? error.name : "unknown",
    ...(code ? { databaseCode: code } : {}),
    ...(identifier(details.table) ? { databaseTable: identifier(details.table) } : {}),
    ...(identifier(details.column) ? { databaseColumn: identifier(details.column) } : {}),
    ...(identifier(details.constraint) ? { databaseConstraint: identifier(details.constraint) } : {}),
  };
}

function getDatabaseErrorDetails(error: unknown): Record<string, unknown> {
  let current: unknown = error;
  let fallback: Record<string, unknown> = {};

  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") break;
    const details = current as Record<string, unknown>;
    const code = typeof details.code === "string" ? details.code : undefined;
    if (code && (/^[0-9A-Z]{5}$/.test(code) || code.startsWith("ECONN") || code.startsWith("ETIMEDOUT") || code === "ENOTFOUND")) {
      return details;
    }
    if (code && !fallback.code) fallback = details;
    current = details.cause;
  }

  return fallback;
}

function knownDatabaseFailure(error: unknown): { status: number; message: string } | undefined {
  const code = getDatabaseErrorDetails(error).code;

  if (code === "42P01" || code === "42703") {
    return {
      status: 503,
      message: "Cấu trúc database Vercel chưa được cập nhật. Cần chạy migration trên đúng DATABASE_URL của Vercel.",
    };
  }

  if (
    typeof code === "string" &&
    (code.startsWith("08") || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(code))
  ) {
    return {
      status: 503,
      message: "Không thể kết nối database Vercel. Kiểm tra DATABASE_URL trong môi trường Production.",
    };
  }

  return undefined;
}

export function massageHandler(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res): Promise<void> => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof MassageError) res.status(error.status).json({ error: error.message, ...error.details });
      else {
        // ORM exception messages may contain customer data in SQL parameters.
        const failure = knownDatabaseFailure(error);
        req.log.error(safeDatabaseDiagnostics(error), "Massage request failed");
        res.status(failure?.status ?? 500).json({
          error: failure?.message ?? "Không thể xử lý dữ liệu. Vui lòng thử lại.",
        });
      }
    }
  };
}
