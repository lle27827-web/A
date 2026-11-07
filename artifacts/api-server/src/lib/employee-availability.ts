export type ActivityMember = { id: number; name: string };
export type ActivitySession = {
  memberId: number | null;
  serviceType: string;
  minutes: number;
  workDate: string;
  createdAt: Date | string;
};
export type ManualAvailability = { memberId: number; statusDate: string; state: "off" };
export type ActivityAppointment = {
  memberId: number | null;
  scheduledAt: Date | string;
  status: string;
};
export type StaffActivity = {
  memberId: number;
  employeeName: string;
  state: "working" | "available" | "off";
  endsAt: string | null;
  lastFinishedAt: string | null;
  serviceType: string | null;
  nextAppointmentAt: string | null;
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
  appointments: readonly ActivityAppointment[] = [],
): StaffActivity[] {
  const today = hoChiMinhDate(now);
  const statuses = new Map(manualStatuses.filter((row) => row.statusDate === today).map((row) => [row.memberId, row.state]));
  const activeSessions = new Map<number, { startsAt: number; endsAt: number; serviceType: string }>();
  const finishedSessions = new Map<number, number>();
  const nextAppointments = new Map<number, number>();
  const dailySessionCounts = new Map<string, Map<number, number>>();
  const todayCounts = new Map<number, number>();
  const lastWorkedDate = new Map<number, string>();
  const nowMs = now.getTime();

  for (const session of sessions) {
    if (!session.memberId || !Number.isFinite(session.minutes) || session.minutes <= 0) continue;
    if (session.workDate < today) {
      let counts = dailySessionCounts.get(session.workDate);
      if (!counts) dailySessionCounts.set(session.workDate, counts = new Map());
      counts.set(session.memberId, (counts.get(session.memberId) ?? 0) + 1);
      const previousLastWork = lastWorkedDate.get(session.memberId);
      if (!previousLastWork || session.workDate > previousLastWork) {
        lastWorkedDate.set(session.memberId, session.workDate);
      }
      continue;
    }
    if (session.workDate !== today) continue;
    todayCounts.set(session.memberId, (todayCounts.get(session.memberId) ?? 0) + 1);
    const startsAt = new Date(session.createdAt).getTime();
    const endsAt = startsAt + session.minutes * 60_000;
    if (!Number.isFinite(startsAt) || startsAt > nowMs) continue;
    if (endsAt <= nowMs) {
      const previousFinish = finishedSessions.get(session.memberId);
      if (previousFinish === undefined || endsAt > previousFinish) finishedSessions.set(session.memberId, endsAt);
      continue;
    }
    const previous = activeSessions.get(session.memberId);
    if (!previous || startsAt > previous.startsAt) {
      activeSessions.set(session.memberId, { startsAt, endsAt, serviceType: session.serviceType });
    }
  }

  for (const appointment of appointments) {
    if (appointment.memberId === null || appointment.status !== "scheduled") continue;
    const scheduledAt = new Date(appointment.scheduledAt).getTime();
    if (!Number.isFinite(scheduledAt) || scheduledAt < nowMs) continue;
    const previous = nextAppointments.get(appointment.memberId);
    if (previous === undefined || scheduledAt < previous) nextAppointments.set(appointment.memberId, scheduledAt);
  }

  const historyDates = [...dailySessionCounts.keys()].sort((a, b) => b.localeCompare(a));
  return [...members]
    .map((member) => {
      const current = activeSessions.get(member.id);
      const off = statuses.get(member.id) === "off";
      const state: StaffActivity["state"] = current ? "working" : off ? "off" : "available";
      return {
        memberId: member.id,
        employeeName: member.name,
        state,
        endsAt: current ? new Date(current.endsAt).toISOString() : null,
        lastFinishedAt: !current && finishedSessions.has(member.id)
          ? new Date(finishedSessions.get(member.id)!).toISOString()
          : null,
        serviceType: current?.serviceType ?? null,
        nextAppointmentAt: nextAppointments.has(member.id)
          ? new Date(nextAppointments.get(member.id)!).toISOString()
          : null,
      };
    })
    .sort((a, b) => {
      if (a.state === "working" && b.state !== "working") return 1;
      if (b.state === "working" && a.state !== "working") return -1;
      if (a.state === "working" && b.state === "working") {
        return activeSessions.get(a.memberId)!.startsAt - activeSessions.get(b.memberId)!.startsAt;
      }
      for (const date of historyDates) {
        const difference = (dailySessionCounts.get(date)?.get(a.memberId) ?? 0) -
          (dailySessionCounts.get(date)?.get(b.memberId) ?? 0);
        if (difference !== 0) return difference;
      }
      const todayDifference = (todayCounts.get(a.memberId) ?? 0) - (todayCounts.get(b.memberId) ?? 0);
      if (todayDifference !== 0) return todayDifference;
      const aLastWork = lastWorkedDate.get(a.memberId) ?? "";
      const bLastWork = lastWorkedDate.get(b.memberId) ?? "";
      if (aLastWork !== bLastWork) return aLastWork.localeCompare(bLastWork);
      return a.employeeName.localeCompare(b.employeeName, "vi");
    });
}
