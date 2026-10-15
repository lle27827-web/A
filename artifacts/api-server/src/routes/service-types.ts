import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, serviceTypesTable, serviceSessionsTable } from "@workspace/db";
import {
  CreateServiceTypeBody, CreateServiceTypeResponse, ListServiceTypesResponse,
  UpdateServiceTypeBody, UpdateServiceTypeParams, UpdateServiceTypeResponse, DeleteServiceTypeParams,
} from "@workspace/api-zod";
import { MassageError } from "../lib/massage";
import { massageHandler, parseInput } from "./massage-errors";

const router: IRouter = Router();
const output = (row: typeof serviceTypesTable.$inferSelect) => ({ ...row, createdAt: row.createdAt.toISOString() });
router.get("/service-types", massageHandler(async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(ListServiceTypesResponse.parse((await db.select().from(serviceTypesTable).orderBy(asc(serviceTypesTable.name))).map(output)));
}));
router.post("/service-types", massageHandler(async (req, res) => {
  const input = parseInput(CreateServiceTypeBody, req.body);
  const name = input.name.trim();
  if (!name) throw new MassageError(400, "Cần nhập tên dịch vụ.");
  const [row] = await db.insert(serviceTypesTable).values({ ...input, name }).returning();
  res.status(201).json(CreateServiceTypeResponse.parse(output(row)));
}));
router.patch("/service-types/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateServiceTypeParams, req.params);
  const input = parseInput(UpdateServiceTypeBody, req.body);
  const name = input.name.trim();
  if (!name) throw new MassageError(400, "Cần nhập tên dịch vụ.");
  const [row] = await db.update(serviceTypesTable).set({ ...input, name }).where(eq(serviceTypesTable.id, id)).returning();
  if (!row) throw new MassageError(404, "Không tìm thấy dịch vụ.");
  res.json(UpdateServiceTypeResponse.parse(output(row)));
}));
router.delete("/service-types/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeleteServiceTypeParams, req.params);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(serviceTypesTable).where(eq(serviceTypesTable.id, id)).for("update");
    if (!row) throw new MassageError(404, "Không tìm thấy dịch vụ.");
    const [used] = await tx.select({ id: serviceSessionsTable.id }).from(serviceSessionsTable)
      .where(eq(serviceSessionsTable.serviceTypeId, id)).limit(1);
    if (used) throw new MassageError(409, "Dịch vụ đã có ca chấm công nên không thể xóa. Bạn có thể sửa giá cho các ca mới.");
    await tx.delete(serviceTypesTable).where(eq(serviceTypesTable.id, id));
  });
  res.sendStatus(204);
}));
export default router;
