export type ActivityMember = { id: number; name: string };
export type ActivitySession = {
  memberId: number | null;
  serviceType: string;
  minutes: number;
  workDate: string;
  createdAt: Date | string;
};
export type ManualAvailability = { memberId: number; statusDate: string; state: "off" };
export type StaffActivity = {
  memberId: number;
  employeeName: string;
  state: "working" | "available" | "off";
  endsAt: string | null;
  serviceType: string | null;
};

export function hoChiMinhDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function deriveStaffActivity(
  members: readonly ActivityMember[],
  sessions: readonly ActivitySession[],
  manualStatuses: readonly ManualAvailability[],
  now = new Date(),
): StaffActivity[] {
  const today = hoChiMinhDate(now);
  const statuses = new Map(manualStatuses.filter((row) => row.statusDate === today).map((row) => [row.memberId, row.state]));
  const activeSessions = new Map<number, { endsAt: number; serviceType: string }>();
  const nowMs = now.getTime();

  for (const session of sessions) {
    if (!session.memberId || session.workDate !== today || !Number.isFinite(session.minutes) || session.minutes <= 0) continue;
    const startsAt = new Date(session.createdAt).getTime();
    const endsAt = startsAt + session.minutes * 60_000;
    if (!Number.isFinite(startsAt) || startsAt > nowMs || endsAt <= nowMs) continue;
    const previous = activeSessions.get(session.memberId);
    if (!previous || endsAt > previous.endsAt) activeSessions.set(session.memberId, { endsAt, serviceType: session.serviceType });
  }

  return [...members]
    .sort((a, b) => a.name.localeCompare(b.name, "vi"))
    .map((member) => {
      const current = activeSessions.get(member.id);
      const off = statuses.get(member.id) === "off";
      return {
        memberId: member.id,
        employeeName: member.name,
        state: current ? "working" : off ? "off" : "available",
        endsAt: current ? new Date(current.endsAt).toISOString() : null,
        serviceType: current?.serviceType ?? null,
      };
    });
}
