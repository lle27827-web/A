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
import { canViewEmployee, noPermissions } from "../lib/facility-permissions";
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
    req.get("Idempotency-Key"),
  )));
}));

router.patch("/members/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateMemberParams, req.params);
  const input = parseInput(UpdateMemberBody, req.body);
  res.json(UpdateMemberResponse.parse(await updateEmployee(
    id,
    input,
    req.get("Idempotency-Key"),
  )));
}));

router.delete("/members/:id", massageHandler(async (req, res): Promise<void> => {
  const params = DeleteMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await deleteMember(params.data.id, req.get("Idempotency-Key"));
  res.sendStatus(204);
}));

export default router;
