import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, appointmentsTable } from "@workspace/db";
import {
  CreateAppointmentBody,
  CreateAppointmentResponse,
  DeleteAppointmentParams,
  ListAppointmentsResponse,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
  UpdateAppointmentResponse,
  type AppointmentInput,
} from "@workspace/api-zod";
import { MassageError } from "../lib/massage";
import { massageHandler, parseInput } from "./massage-errors";

const router: IRouter = Router();

function output(row: typeof appointmentsTable.$inferSelect) {
  return {
    ...row,
    scheduledAt: row.scheduledAt.toISOString(),
    request: row.request ?? "",
    note: row.note ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizedInput(input: AppointmentInput) {
  const customerName = input.customerName.trim();
  const phone = input.phone.trim();
  if (!customerName) throw new MassageError(400, "Cần nhập tên khách hàng.");
  if (!phone) throw new MassageError(400, "Cần nhập số điện thoại.");
  const scheduledAt = new Date(input.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime())) throw new MassageError(400, "Ngày giờ hẹn không hợp lệ.");
  return { customerName, phone, scheduledAt, request: input.request?.trim() ?? "", note: input.note ?? "" };
}

router.get("/appointments", massageHandler(async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  const rows = await db.select().from(appointmentsTable).orderBy(asc(appointmentsTable.scheduledAt));
  res.json(ListAppointmentsResponse.parse(rows.map(output)));
}));

router.post("/appointments", massageHandler(async (req, res) => {
  const input = normalizedInput(parseInput(CreateAppointmentBody, req.body));
  const [row] = await db.insert(appointmentsTable).values(input).returning();
  res.status(201).json(CreateAppointmentResponse.parse(output(row)));
}));

router.patch("/appointments/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateAppointmentParams, req.params);
  const input = normalizedInput(parseInput(UpdateAppointmentBody, req.body));
  const [row] = await db.update(appointmentsTable)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();
  if (!row) throw new MassageError(404, "Không tìm thấy lịch hẹn.");
  res.json(UpdateAppointmentResponse.parse(output(row)));
}));

router.delete("/appointments/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(DeleteAppointmentParams, req.params);
  const [row] = await db.delete(appointmentsTable)
    .where(eq(appointmentsTable.id, id))
    .returning({ id: appointmentsTable.id });
  if (!row) throw new MassageError(404, "Không tìm thấy lịch hẹn.");
  res.sendStatus(204);
}));

export default router;
