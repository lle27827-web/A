import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  CreateTaskBody,
  CreateTaskResponse,
  DeleteTaskParams,
  GetTaskSummaryResponse,
  ListTasksQueryParams,
  ListTasksResponse,
  UpdateTaskBody,
  UpdateTaskParams,
  UpdateTaskResponse,
} from "@workspace/api-zod";
import { db, tasksTable, type TaskPriority, type TaskStatus } from "@workspace/db";
import { requireOwner } from "../middlewares/owner";

const router: IRouter = Router();

type TaskWrite = {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
};

function toTaskResponse(task: typeof tasksTable.$inferSelect) {
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

router.get("/tasks", async (req, res): Promise<void> => {
  const query = ListTasksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const filters = [];
  const search = query.data.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    filters.push(
      or(ilike(tasksTable.title, pattern), ilike(tasksTable.description, pattern)),
    );
  }
  if (query.data.status) {
    filters.push(eq(tasksTable.status, query.data.status));
  }
  if (query.data.priority) {
    filters.push(eq(tasksTable.priority, query.data.priority));
  }

  const rows = await db
    .select()
    .from(tasksTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(tasksTable.dueDate), desc(tasksTable.createdAt));

  res.json(ListTasksResponse.parse(rows.map(toTaskResponse)));
});

router.get("/tasks/summary", async (_req, res): Promise<void> => {
  const [row] = await db
    .select({
      total: count(),
      todo: sql<number>`count(*) filter (where ${tasksTable.status} = 'todo')`,
      inProgress: sql<number>`count(*) filter (where ${tasksTable.status} = 'in_progress')`,
      done: sql<number>`count(*) filter (where ${tasksTable.status} = 'done')`,
      overdue: sql<number>`count(*) filter (where ${tasksTable.status} <> 'done' and ${tasksTable.dueDate} < current_date)`,
    })
    .from(tasksTable);

  res.json(GetTaskSummaryResponse.parse({
    total: Number(row.total),
    todo: Number(row.todo),
    inProgress: Number(row.inProgress),
    done: Number(row.done),
    overdue: Number(row.overdue),
  }));
});

router.post("/tasks", requireOwner, async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const values: TaskWrite = {
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    status: parsed.data.status as TaskStatus,
    priority: parsed.data.priority as TaskPriority,
    dueDate: parsed.data.dueDate ?? null,
  };

  const [task] = await db
    .insert(tasksTable)
    .values({
      ...values,
      isExample: false,
    })
    .returning();

  res.status(201).json(CreateTaskResponse.parse(toTaskResponse(task)));
});

router.patch("/tasks/:id", requireOwner, async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body ?? {}).length === 0) {
    res.status(400).json({
      error: parsed.success ? "Cần có ít nhất một trường để cập nhật." : parsed.error.message,
    });
    return;
  }

  const update: Partial<TaskWrite> = {};
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.status !== undefined) update.status = parsed.data.status as TaskStatus;
  if (parsed.data.priority !== undefined) update.priority = parsed.data.priority as TaskPriority;
  if ("dueDate" in parsed.data) update.dueDate = parsed.data.dueDate ?? null;

  const [task] = await db
    .update(tasksTable)
    .set(update)
    .where(eq(tasksTable.id, params.data.id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Không tìm thấy công việc." });
    return;
  }

  res.json(UpdateTaskResponse.parse(toTaskResponse(task)));
});

router.delete("/tasks/:id", requireOwner, async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [task] = await db
    .delete(tasksTable)
    .where(eq(tasksTable.id, params.data.id))
    .returning({ id: tasksTable.id });

  if (!task) {
    res.status(404).json({ error: "Không tìm thấy công việc." });
    return;
  }

  res.sendStatus(204);
});

export default router;
