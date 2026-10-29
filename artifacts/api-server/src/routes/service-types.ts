import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import {
  cardUsageHistoryTable,
  db,
  isPartitionedStorageEnabled,
  readPartitionedTable,
  serviceSessionsTable,
  serviceTypesTable,
  withPartitionWriteMutex,
} from "@workspace/db";
import {
  CreateServiceTypeBody, CreateServiceTypeResponse, ListServiceTypesResponse,
  UpdateServiceTypeBody, UpdateServiceTypeParams, UpdateServiceTypeResponse, DeleteServiceTypeParams,
} from "@workspace/api-zod";
import { idempotentTransaction, MassageError, serviceTypeHasHistory } from "../lib/massage";
import { massageHandler, parseInput } from "./massage-errors";
import { commitPartitionedMutations, deleteMutation, operationIdFromRequest, upsertMutation } from "../lib/partitioned-mutations";

const router: IRouter = Router();
const output = (row: typeof serviceTypesTable.$inferSelect) => ({ ...row, createdAt: row.createdAt.toISOString() });
router.get("/service-types", massageHandler(async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  const rows = isPartitionedStorageEnabled()
    ? (await readPartitionedTable("service_types") as unknown as (typeof serviceTypesTable.$inferSelect)[])
      .sort((a, b) => a.name.localeCompare(b.name, "vi"))
    : await db.select().from(serviceTypesTable).orderBy(asc(serviceTypesTable.name));
  res.json(ListServiceTypesResponse.parse(rows.map(output)));
}));
router.post("/service-types", massageHandler(async (req, res) => {
  const input = parseInput(CreateServiceTypeBody, req.body);
  const name = input.name.trim();
  if (!name) throw new MassageError(400, "Cần nhập tên dịch vụ.");
  if (isPartitionedStorageEnabled()) {
    const operation = await commitPartitionedMutations({
      operationId: operationIdFromRequest(req.get("Idempotency-Key"), "dịch vụ"),
      lockName: "service-types",
      action: "service-type.create",
      request: { ...input, name },
      expectedEventCount: 1,
      idAllocations: { service_types: 1 },
      build: (reserved) => {
        const id = reserved.allocatedIds.service_types?.[0];
        if (!id) throw new MassageError(503, "Không cấp được mã dịch vụ.");
        return [upsertMutation("service_types", id, { ...input, name, id, createdAt: new Date() })];
      },
    });
    const id = operation.allocatedIds.service_types?.[0];
    const row = (await readPartitionedTable("service_types") as unknown as (typeof serviceTypesTable.$inferSelect)[])
      .find((item) => item.id === id);
    if (!row) throw new MassageError(503, "Không tải lại được dịch vụ sau khi lưu.");
    res.status(201).json(CreateServiceTypeResponse.parse(output(row)));
    return;
  }
   const row = await idempotentTransaction(
     operationIdFromRequest(req.get("Idempotency-Key"), "thêm dịch vụ"),
     "thêm dịch vụ",
     "service-type.create",
     { ...input, name },
     async (tx) => (await tx.insert(serviceTypesTable).values({ ...input, name }).returning())[0],
   );
  res.status(201).json(CreateServiceTypeResponse.parse(output(row)));
}));
router.patch("/service-types/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateServiceTypeParams, req.params);
  const input = parseInput(UpdateServiceTypeBody, req.body);
  const name = input.name.trim();
  if (!name) throw new MassageError(400, "Cần nhập tên dịch vụ.");
  if (isPartitionedStorageEnabled()) {
    const rows = await readPartitionedTable("service_types") as unknown as (typeof serviceTypesTable.$inferSelect)[];
    const old = rows.find((item) => item.id === id);
    if (!old) throw new MassageError(404, "Không tìm thấy dịch vụ.");
    await commitPartitionedMutations({
      operationId: operationIdFromRequest(req.get("Idempotency-Key"), "dịch vụ"),
      lockName: `service-type:${id}`,
      action: "service-type.update",
      request: { id, input: { ...input, name } },
      expectedEventCount: 1,
      build: () => [upsertMutation("service_types", id, { ...old, ...input, name })],
    });
    const row = (await readPartitionedTable("service_types") as unknown as (typeof serviceTypesTable.$inferSelect)[])
      .find((item) => item.id === id);
    if (!row) throw new MassageError(503, "Không tải lại được dịch vụ sau khi sửa.");
    res.json(UpdateServiceTypeResponse.parse(output(row)));
    return;
  }
  const row = await idempotentTransaction(
    operationIdFromRequest(req.get("Idempotency-Key"), "sửa dịch vụ"),
    "sửa dịch vụ",
    "service-type.update",
    { id, input: { ...input, name } },
    async (tx) => (await tx.update(serviceTypesTable).set({ ...input, name }).where(eq(serviceTypesTable.id, id)).returning())[0],
  );
  if (!row) throw new MassageError(404, "Không tìm thấy dịch vụ.");
  res.json(UpdateServiceTypeResponse.parse(output(row)));
}));
router.delete("/service-types/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeleteServiceTypeParams, req.params);
  if (isPartitionedStorageEnabled()) {
    await withPartitionWriteMutex("card-ledger", async () => {
      const [servicesRaw, sessionsRaw, historyRaw] = await Promise.all([
        readPartitionedTable("service_types"),
        readPartitionedTable("service_sessions"),
        readPartitionedTable("card_usage_history"),
      ]);
      const services = servicesRaw as unknown as (typeof serviceTypesTable.$inferSelect)[];
      const sessions = sessionsRaw as unknown as (typeof serviceSessionsTable.$inferSelect)[];
      const history = historyRaw as unknown as (typeof cardUsageHistoryTable.$inferSelect)[];
      if (!services.some((item) => item.id === id)) throw new MassageError(404, "Không tìm thấy dịch vụ.");
      if (serviceTypeHasHistory(id, sessions, history)) {
        throw new MassageError(409, "Dịch vụ đã có ca ghi nhận, không thể xóa.");
      }
      await commitPartitionedMutations({
        operationId: operationIdFromRequest(req.get("Idempotency-Key"), "xóa dịch vụ"),
        lockName: `service-type:${id}`,
        action: "service-type.delete",
        request: { id },
        expectedEventCount: 1,
        alreadyLocked: true,
        build: () => [deleteMutation("service_types", id)],
      });
    });
    res.sendStatus(204);
    return;
  }
  await idempotentTransaction(
    operationIdFromRequest(req.get("Idempotency-Key"), "xóa dịch vụ"),
    "xóa dịch vụ",
    "service-type.delete",
    { id },
    async (tx) => {
      const [row] = await tx.select().from(serviceTypesTable).where(eq(serviceTypesTable.id, id)).for("update");
      if (!row) throw new MassageError(404, "Không tìm thấy dịch vụ.");
      const [sessionUse] = await tx.select({ id: serviceSessionsTable.id }).from(serviceSessionsTable)
        .where(eq(serviceSessionsTable.serviceTypeId, id)).limit(1);
      const [archivedUse] = await tx.select({ id: cardUsageHistoryTable.sourceSessionId }).from(cardUsageHistoryTable)
        .where(eq(cardUsageHistoryTable.serviceTypeId, id)).limit(1);
      if (sessionUse || archivedUse) {
        throw new MassageError(409, "Dịch vụ đã có ca ghi nhận, không thể xóa.");
      }
      await tx.delete(serviceTypesTable).where(eq(serviceTypesTable.id, id));
    },
  );
  res.sendStatus(204);
}));
export default router;
