import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, managerGrantsTable } from "@workspace/db";
import { CreateManagerBody, CreateManagerResponse, DeleteManagerParams, ListManagersResponse } from "@workspace/api-zod";
import { requireOwner } from "../middlewares/owner";
import { canonicalEmail } from "../lib/permissions";
import { MassageError } from "../lib/massage";
import { massageHandler, parseInput } from "./massage-errors";

const router: IRouter = Router();
const output = (row: typeof managerGrantsTable.$inferSelect) => ({ ...row, createdAt: row.createdAt.toISOString() });

router.get("/managers", requireOwner, massageHandler(async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(ListManagersResponse.parse((await db.select().from(managerGrantsTable).orderBy(asc(managerGrantsTable.email))).map(output)));
}));

router.post("/managers", requireOwner, massageHandler(async (req, res) => {
  const input = parseInput(CreateManagerBody, req.body);
  const email = canonicalEmail(input.email);
  if (email === canonicalEmail(process.env.OWNER_EMAIL ?? "")) {
    throw new MassageError(409, "Đây là chủ sở hữu, không cần cấp thêm quyền quản lý.");
  }
  const [row] = await db.insert(managerGrantsTable).values({ email })
    .onConflictDoNothing({ target: managerGrantsTable.email }).returning();
  if (!row) throw new MassageError(409, "Email này đã được cấp quyền quản lý.");
  res.status(201).json(CreateManagerResponse.parse(output(row)));
}));

router.delete("/managers/:id", requireOwner, massageHandler(async (req, res) => {
  const { id } = parseInput(DeleteManagerParams, req.params);
  const [row] = await db.delete(managerGrantsTable).where(eq(managerGrantsTable.id, id)).returning();
  if (!row) throw new MassageError(404, "Không tìm thấy người quản lý.");
  res.sendStatus(204);
}));

export default router;
