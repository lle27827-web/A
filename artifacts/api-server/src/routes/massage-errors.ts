import type { Request, RequestHandler, Response } from "express";
import { MassageError } from "../lib/massage";

export function parseInput<T>(schema: {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new MassageError(400, "Thông tin nhập không hợp lệ. Kiểm tra các trường và giới hạn số giờ, số tiền.");
  return parsed.data;
}
export function massageHandler(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res): Promise<void> => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof MassageError) res.status(error.status).json({ error: error.message });
      else {
        // ORM exception messages may contain customer data in SQL parameters.
        req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Massage request failed");
        res.status(500).json({ error: "Không thể xử lý dữ liệu. Vui lòng thử lại." });
      }
    }
  };
}
