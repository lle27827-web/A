import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import {
  CreateMemberBody,
  CreateMemberResponse,
  DeleteMemberParams,
  ListMembersResponse,
} from "@workspace/api-zod";
import { db, membersTable } from "@workspace/db";
import { requireOwner } from "../middlewares/owner";

const router: IRouter = Router();

router.get("/members", async (_req, res): Promise<void> => {
  const members = await db.select().from(membersTable).orderBy(asc(membersTable.name));
  res.json(ListMembersResponse.parse(members.map((member) => ({
    ...member,
    createdAt: member.createdAt.toISOString(),
  }))));
});

router.post("/members", requireOwner, async (req, res): Promise<void> => {
  const parsed = CreateMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [member] = await db.insert(membersTable).values(parsed.data).returning();
  res.status(201).json(CreateMemberResponse.parse({
    ...member,
    createdAt: member.createdAt.toISOString(),
  }));
});

router.delete("/members/:id", requireOwner, async (req, res): Promise<void> => {
  const params = DeleteMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [member] = await db.delete(membersTable)
    .where(eq(membersTable.id, params.data.id))
    .returning({ id: membersTable.id });
  if (!member) {
    res.status(404).json({ error: "Không tìm thấy thành viên." });
    return;
  }
  res.sendStatus(204);
});

export default router;
