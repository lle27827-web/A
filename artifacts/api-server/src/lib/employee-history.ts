import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, isPartitionedStorageEnabled, membersTable, memberVersionsTable, readPartitionedTable, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import type { MemberInput, MemberRecord, MemberUpdate } from "@workspace/api-zod";
import { MassageError, retainedMonthBounds } from "./massage";
import { buildSampleMemberNames } from "./sample-member-names";

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

export async function createEmployee(input: MemberInput) {
  const name = input.name.trim();
  if (!name) throw new MassageError(400, "Cần nhập tên nhân viên.");
  return db.transaction(async (tx) => {
    const [member] = await tx.insert(membersTable).values({ ...input, name }).returning();
    await tx.insert(memberVersionsTable).values({
      memberId: member.id, name: member.name, hourlyRate: member.hourlyRate, recordedAt: member.createdAt,
    });
    return memberResponse(member);
  });
}

export async function createSampleEmployeesBatchOnce() {
  const names = buildSampleMemberNames();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(721001001::bigint)`);
    const existing = await tx.select({ name: membersTable.name })
      .from(membersTable)
      .where(inArray(membersTable.name, names));
    if (existing.length > 0) {
      const examples = existing.slice(0, 3).map(({ name }) => `“${name}”`).join(", ");
      throw new MassageError(
        409,
        `Không tạo dữ liệu mẫu: đã có ${existing.length} tên trong dãy 1–1000 (${examples}${existing.length > 3 ? ", …" : ""}). Không có bản ghi nào được thêm.`,
      );
    }

    const created = await tx.insert(membersTable)
      .values(names.map((name) => ({ name, hourlyRate: 0 })))
      .returning();
    if (created.length !== names.length) {
      throw new Error("The sample employee batch was not fully inserted.");
    }
    await tx.insert(memberVersionsTable).values(created.map((member) => ({
      memberId: member.id,
      name: member.name,
      hourlyRate: member.hourlyRate,
      recordedAt: member.createdAt,
    })));

    return {
      createdCount: created.length,
      firstName: names[0]!,
      lastName: names.at(-1)!,
    };
  });
}

export async function updateEmployee(id: number, input: MemberUpdate) {
  if (!Object.keys(input).length || (input.name !== undefined && !input.name.trim())) {
    throw new MassageError(400, "Cần thông tin cập nhật hợp lệ.");
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
