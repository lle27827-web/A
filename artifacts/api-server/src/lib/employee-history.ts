import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, isPartitionedStorageEnabled, membersTable, memberVersionsTable, readPartitionedTable, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import type { MemberInput, MemberRecord, MemberUpdate } from "@workspace/api-zod";
import { MassageError, retainedMonthBounds } from "./massage";
import { commitPartitionedMutations, operationIdFromRequest, upsertMutation } from "./partitioned-mutations";
import { withPartitionWriteMutex } from "@workspace/db";

function memberResponse(member: typeof membersTable.$inferSelect) {
  return {
    ...member,
    createdAt: new Date(member.createdAt).toISOString(),
    deletedAt: member.deletedAt ? new Date(member.deletedAt).toISOString() : null,
  };
}

type MemberSnapshot = Omit<MemberRecord, "createdAt" | "deletedAt"> & { createdAt: string; deletedAt: string | null };

export async function listMembersForPeriod(month?: string, memberId?: number): Promise<MemberSnapshot[]> {
  if (isPartitionedStorageEnabled()) {
    return listMembersAcrossPartitions(month, memberId);
  }
  if (!month) {
    const rows = await db.select().from(membersTable)
      .where(and(isNull(membersTable.deletedAt), memberId ? eq(membersTable.id, memberId) : undefined))
      .orderBy(asc(membersTable.name));
    return rows.map(memberResponse);
  }
  const { start, end } = retainedMonthBounds(month);
  const startInstant = new Date(`${start}T00:00:00+07:00`);
  const endInstant = new Date(`${end}T00:00:00+07:00`);
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(membersTable).where(and(
      memberId ? eq(membersTable.id, memberId) : undefined,
      or(
        and(lt(membersTable.createdAt, endInstant), or(isNull(membersTable.deletedAt), gt(membersTable.deletedAt, startInstant))),
        sql`exists (select 1 from ${serviceSessionsTable}
          where ${serviceSessionsTable}."member_id" = ${membersTable}."id"
            and ${serviceSessionsTable}."work_date" >= ${start} and ${serviceSessionsTable}."work_date" < ${end}
            and (${serviceSessionsTable}."card_id" is null or exists (
              select 1 from ${treatmentCardsTable}
              where ${treatmentCardsTable}."id" = ${serviceSessionsTable}."card_id"
                and ${treatmentCardsTable}."deleted_at" is null)))`,
      ),
    ));
    if (!rows.length) return [];
    const ids = rows.map((member) => member.id);
    const versions = await tx.select().from(memberVersionsTable).where(and(
      inArray(memberVersionsTable.memberId, ids), lt(memberVersionsTable.recordedAt, endInstant),
    )).orderBy(desc(memberVersionsTable.recordedAt), desc(memberVersionsTable.id));
    const sessions = await tx.select().from(serviceSessionsTable).where(and(
      inArray(serviceSessionsTable.memberId, ids), gte(serviceSessionsTable.workDate, start), lt(serviceSessionsTable.workDate, end),
      sql`(${serviceSessionsTable.cardId} is null or exists (
        select 1 from ${treatmentCardsTable} where ${treatmentCardsTable}."id" = ${serviceSessionsTable}."card_id"
          and ${treatmentCardsTable}."deleted_at" is null))`,
    )).orderBy(desc(serviceSessionsTable.workDate), desc(serviceSessionsTable.id));
    const names = new Map<number, typeof versions[number]>();
    const visits = new Map<number, typeof sessions[number]>();
    for (const version of versions) if (!names.has(version.memberId)) names.set(version.memberId, version);
    for (const session of sessions) if (session.memberId !== null && !visits.has(session.memberId)) visits.set(session.memberId, session);
    return rows.map((member) => {
      const version = names.get(member.id);
      const visit = visits.get(member.id);
      return {
        ...memberResponse(member),
        name: version?.name ?? visit?.employeeName ?? member.name,
        hourlyRate: version?.hourlyRate ?? visit?.hourlyRate ?? member.hourlyRate,
        historicalNameSource: version ? "version" as const : visit ? "session" as const : "unverified" as const,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function listMembersAcrossPartitions(month?: string, memberId?: number): Promise<MemberSnapshot[]> {
  const [members, versions, sessions, cards] = await Promise.all([
    readPartitionedTable("members"),
    readPartitionedTable("member_versions"),
    month ? readPartitionedTable("service_sessions") : Promise.resolve([]),
    month ? readPartitionedTable("treatment_cards") : Promise.resolve([]),
  ]);
  const memberRows = members as unknown as (typeof membersTable.$inferSelect)[];
  const versionRows = versions as unknown as (typeof memberVersionsTable.$inferSelect)[];
  const sessionRows = sessions as unknown as (typeof serviceSessionsTable.$inferSelect)[];
  const cardRows = cards as unknown as (typeof treatmentCardsTable.$inferSelect)[];

  if (!month) {
    return memberRows
      .filter((member) => member.deletedAt === null && (memberId === undefined || member.id === memberId))
      .map(memberResponse)
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }

  const { start, end } = retainedMonthBounds(month);
  const startInstant = new Date(`${start}T00:00:00+07:00`);
  const endInstant = new Date(`${end}T00:00:00+07:00`);
  const activeCardIds = new Set(cardRows.filter((card) => card.deletedAt === null).map((card) => card.id));
  const monthSessions = sessionRows.filter((session) =>
    session.workDate >= start &&
    session.workDate < end &&
    session.memberId !== null &&
    (session.cardId === null || activeCardIds.has(session.cardId)),
  ).sort((a, b) => b.workDate.localeCompare(a.workDate) || b.id - a.id);
  const monthVersions = versionRows.filter((version) =>
    new Date(version.recordedAt).getTime() < endInstant.getTime(),
  ).sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime() || b.id - a.id);
  const latestVersion = new Map<number, typeof versionRows[number]>();
  const latestVisit = new Map<number, typeof monthSessions[number]>();
  for (const version of monthVersions) {
    if (!latestVersion.has(version.memberId)) latestVersion.set(version.memberId, version);
  }
  for (const session of monthSessions) {
    if (session.memberId !== null && !latestVisit.has(session.memberId)) latestVisit.set(session.memberId, session);
  }

  return memberRows
    .filter((member) => {
      if (memberId !== undefined && member.id !== memberId) return false;
      const createdAt = new Date(member.createdAt);
      const deletedAt = member.deletedAt ? new Date(member.deletedAt) : null;
      const existedDuringMonth =
        createdAt < endInstant && (!deletedAt || deletedAt > startInstant);
      return existedDuringMonth || latestVisit.has(member.id);
    })
    .map((member) => {
      const version = latestVersion.get(member.id);
      const visit = latestVisit.get(member.id);
      return {
        ...memberResponse(member),
        name: version?.name ?? visit?.employeeName ?? member.name,
        hourlyRate: version?.hourlyRate ?? visit?.hourlyRate ?? member.hourlyRate,
        historicalNameSource: version ? "version" as const : visit ? "session" as const : "unverified" as const,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

export async function createEmployee(input: MemberInput, operationId?: string) {
  const name = input.name.trim();
  if (!name) throw new MassageError(400, "Cần nhập tên nhân viên.");
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi thêm nhân viên.");
    const now = new Date();
    const operation = await commitPartitionedMutations({
      operationId,
      lockName: "members",
      action: "member.create",
      request: { ...input, name },
      expectedEventCount: 2,
      idAllocations: { members: 1, member_versions: 1 },
      build: (reserved) => {
        const id = reserved.allocatedIds.members?.[0];
        const versionId = reserved.allocatedIds.member_versions?.[0];
        if (!id || !versionId) throw new MassageError(503, "Không cấp được mã nhân viên.");
        const member = { ...input, name, id, createdAt: now, deletedAt: null };
        return [
          upsertMutation("members", id, member),
          upsertMutation("member_versions", versionId, {
            id: versionId, memberId: id, name, hourlyRate: input.hourlyRate ?? 0,
            isBaseline: false, recordedAt: now,
          }),
        ];
      },
    });
    const id = operation.allocatedIds.members?.[0];
    const [member] = (await readPartitionedTable("members") as unknown as (typeof membersTable.$inferSelect)[])
      .filter((row) => row.id === id);
    if (!member) throw new MassageError(503, "Không tải lại được nhân viên sau khi lưu.");
    return memberResponse(member);
  }
  return db.transaction(async (tx) => {
    const [member] = await tx.insert(membersTable).values({ ...input, name }).returning();
    await tx.insert(memberVersionsTable).values({
      memberId: member.id, name: member.name, hourlyRate: member.hourlyRate, recordedAt: member.createdAt,
    });
    return memberResponse(member);
  });
}

export async function updateEmployee(id: number, input: MemberUpdate, operationId?: string) {
  if (!Object.keys(input).length || (input.name !== undefined && !input.name.trim())) {
    throw new MassageError(400, "Cần thông tin cập nhật hợp lệ.");
  }
  if (isPartitionedStorageEnabled()) {
    if (!operationId) throw new MassageError(400, "Thiếu mã chống ghi trùng khi sửa nhân viên.");
    return withPartitionWriteMutex(`member:${id}`, async () => {
      const [members, versions] = await Promise.all([
        readPartitionedTable("members"),
        readPartitionedTable("member_versions"),
      ]);
      const old = (members as unknown as (typeof membersTable.$inferSelect)[])
        .find((row) => row.id === id && row.deletedAt === null);
      if (!old) throw new MassageError(404, "Không tìm thấy nhân viên đang hoạt động.");
      const memberVersions = versions as unknown as (typeof memberVersionsTable.$inferSelect)[];
      const hasVersion = memberVersions.some((row) => row.memberId === id);
      const nextName = input.name === undefined ? old.name : input.name.trim();
      const nextRate = input.hourlyRate === undefined ? old.hourlyRate : input.hourlyRate;
      const now = new Date();
      await commitPartitionedMutations({
        operationId,
        lockName: `member:${id}`,
        action: "member.update",
        request: { id, input },
        expectedEventCount: hasVersion ? 2 : 3,
        idAllocations: { member_versions: hasVersion ? 1 : 2 },
        alreadyLocked: true,
        build: (reserved) => {
          const versionIds = reserved.allocatedIds.member_versions ?? [];
          const changes = [
            upsertMutation("members", id, { ...old, ...input, name: nextName, hourlyRate: nextRate }),
          ];
          let index = 0;
          if (!hasVersion) {
            const baselineId = versionIds[index++];
            if (!baselineId) throw new MassageError(503, "Không cấp được mã lịch sử nhân viên.");
            changes.push(upsertMutation("member_versions", baselineId, {
              id: baselineId, memberId: id, name: old.name, hourlyRate: old.hourlyRate,
              isBaseline: true, recordedAt: now,
            }));
          }
          const versionId = versionIds[index];
          if (!versionId) throw new MassageError(503, "Không cấp được mã lịch sử nhân viên.");
          changes.push(upsertMutation("member_versions", versionId, {
            id: versionId, memberId: id, name: nextName, hourlyRate: nextRate,
            isBaseline: false, recordedAt: now,
          }));
          return changes;
        },
      });
      const member = (await readPartitionedTable("members") as unknown as (typeof membersTable.$inferSelect)[])
        .find((row) => row.id === id);
      if (!member) throw new MassageError(503, "Không tải lại được nhân viên sau khi sửa.");
      return memberResponse(member);
    });
  }
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(membersTable).where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt))).for("update");
    if (!old) throw new MassageError(404, "Không tìm thấy nhân viên đang hoạt động.");
    // Older installations can lack versions. Capture only what is known now,
    // never backdate a current name into an unknown historical period.
    const [existing] = await tx.select({ id: memberVersionsTable.id }).from(memberVersionsTable).where(eq(memberVersionsTable.memberId, id)).limit(1);
    if (!existing) await tx.insert(memberVersionsTable).values({
      memberId: id, name: old.name, hourlyRate: old.hourlyRate, isBaseline: true, recordedAt: sql`clock_timestamp()`,
    });
    const [member] = await tx.update(membersTable).set({ ...input, ...(input.name === undefined ? {} : { name: input.name.trim() }) })
      .where(eq(membersTable.id, id)).returning();
    await tx.insert(memberVersionsTable).values({
      memberId: id, name: member.name, hourlyRate: member.hourlyRate, recordedAt: sql`clock_timestamp()`,
    });
    return memberResponse(member);
  });
}
