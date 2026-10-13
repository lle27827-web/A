import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import {
  CreateMemberBody,
  CreateMemberResponse,
  DeleteMemberParams,
  ListMembersResponse,
  UpdateMemberBody,
  UpdateMemberParams,
  UpdateMemberResponse,
} from "@workspace/api-zod";
import { db, membersTable } from "@workspace/db";
import { deleteMember } from "../lib/massage";
import { requireEditor, requireSignedIn } from "../middlewares/owner";
import { massageHandler, parseInput } from "./massage-errors";

const router: IRouter = Router();

router.get("/members", requireSignedIn, async (_req, res): Promise<void> => {
  const members = await db.select().from(membersTable).orderBy(asc(membersTable.name));
  res.json(ListMembersResponse.parse(members.map((member) => ({
    ...member,
    createdAt: member.createdAt.toISOString(),
  }))));
});

router.post("/members", requireEditor, async (req, res): Promise<void> => {
  const parsed = CreateMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) { res.status(400).json({ error: "Cần nhập tên nhân viên." }); return; }
  const [member] = await db.insert(membersTable).values({ ...parsed.data, name }).returning();
  res.status(201).json(CreateMemberResponse.parse({
    ...member,
    createdAt: member.createdAt.toISOString(),
  }));
});

router.patch("/members/:id", requireEditor, massageHandler(async (req, res) => {
  const { id } = parseInput(UpdateMemberParams, req.params);
  const input = parseInput(UpdateMemberBody, req.body);
  if (!Object.keys(input).length || (input.name !== undefined && !input.name.trim())) {
    res.status(400).json({ error: "Cần thông tin cập nhật hợp lệ." }); return;
  }
  const [member] = await db.update(membersTable).set({ ...input, ...(input.name === undefined ? {} : { name: input.name.trim() }) })
    .where(eq(membersTable.id, id)).returning();
  if (!member) { res.status(404).json({ error: "Không tìm thấy nhân viên." }); return; }
  res.json(UpdateMemberResponse.parse({ ...member, createdAt: member.createdAt.toISOString() }));
}));

router.delete("/members/:id", requireEditor, massageHandler(async (req, res): Promise<void> => {
  const params = DeleteMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await deleteMember(params.data.id);
  res.sendStatus(204);
}));

export default router;
