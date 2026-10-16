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

const router: IRouter = Router();

router.get("/members", massageHandler(async (req, res) => {
  const { month } = parseInput(ListMembersQueryParams, req.query);
  res.set("Cache-Control", "private, no-store");
  res.json(ListMembersResponse.parse(await listMembersForPeriod(month)));
}));

router.post("/members", massageHandler(async (req, res): Promise<void> => {
  const parsed = CreateMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json(CreateMemberResponse.parse(await createEmployee(parsed.data)));
}));

router.patch("/members/:id", massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateMemberParams, req.params);
  const input = parseInput(UpdateMemberBody, req.body);
  res.json(UpdateMemberResponse.parse(await updateEmployee(id, input)));
}));

router.delete("/members/:id", massageHandler(async (req, res): Promise<void> => {
  const params = DeleteMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await deleteMember(params.data.id);
  res.sendStatus(204);
}));

export default router;
