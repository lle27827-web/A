import { Router, type IRouter } from "express";
import {
  CreateMemberBody,
  CreateMemberResponse,
  DeleteMemberParams,
  ListMembersResponse,
  ListMembersQueryParams,
  UpdateMemberBody,
  UpdateMemberParams,
  UpdateMemberResponse,
} from "@workspace/api-zod";
import { deleteMember } from "../lib/massage";
import { createEmployee, listMembersForPeriod, updateEmployee } from "../lib/employee-history";
import { massageHandler, parseInput } from "./massage-errors";
import { canDeleteEmployee, canViewEmployee, noPermissions } from "../lib/facility-permissions";
import { MassageError } from "../lib/massage";
import { operationIdFromRequest } from "../lib/partitioned-mutations";
import type { OwnerAuthStatus } from "../lib/owner-auth";

const router: IRouter = Router();

router.get("/members", massageHandler(async (req, res) => {
  const { month } = parseInput(ListMembersQueryParams, req.query);
  res.set("Cache-Control", "private, no-store");
  const permissions = (res.locals.facilityAuth as OwnerAuthStatus | undefined)?.permissions ?? noPermissions();
  res.json(ListMembersResponse.parse((await listMembersForPeriod(month)).filter((member) => canViewEmployee(permissions, member.id))));
}));

router.post("/members", massageHandler(async (req, res): Promise<void> => {
  const parsed = CreateMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json(CreateMemberResponse.parse(await createEmployee(
    parsed.data,
    operationIdFromRequest(req.get("Idempotency-Key"), "thêm nhân viên"),
  )));
}));

router.patch("/members/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateMemberParams, req.params);
  const input = parseInput(UpdateMemberBody, req.body);
  res.json(UpdateMemberResponse.parse(await updateEmployee(
    id,
    input,
    operationIdFromRequest(req.get("Idempotency-Key"), "sửa nhân viên"),
  )));
}));

router.delete("/members/:id", massageHandler(async (req, res): Promise<void> => {
  const params = DeleteMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const facilityAuth = res.locals.facilityAuth as OwnerAuthStatus | undefined;
  if (!facilityAuth?.isOwner && !canDeleteEmployee(facilityAuth?.permissions ?? noPermissions(), params.data.id)) {
    throw new MassageError(403, "Bạn chưa được cấp quyền xóa nhân viên này.");
  }
  await deleteMember(params.data.id, operationIdFromRequest(req.get("Idempotency-Key"), "xóa nhân viên"));
  res.sendStatus(204);
}));

export default router;
