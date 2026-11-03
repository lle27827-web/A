export type ServiceDurationDetail = {
  serviceType: string;
  minutes: number;
  visits: number;
};

export type ServiceHoursDetail = {
  serviceType: string;
  minutes: number;
};

export function summarizeServiceHours(
  sessions: readonly { serviceType: string; minutes: number }[],
): ServiceHoursDetail[] {
  const totals = new Map<string, ServiceHoursDetail>();
  for (const session of sessions) {
    const serviceType = session.serviceType.trim() || 'Không tên';
    const group = totals.get(serviceType);
    if (group) group.minutes += session.minutes;
    else totals.set(serviceType, { serviceType, minutes: session.minutes });
  }
  return [...totals.values()].sort((a, b) => a.serviceType.localeCompare(b.serviceType, 'vi'));
}

export function summarizeServiceDurations(
  sessions: readonly { serviceType: string; minutes: number }[],
): ServiceDurationDetail[] {
  const groups = new Map<string, ServiceDurationDetail>();
  for (const session of sessions) {
    const serviceType = session.serviceType.trim() || 'Không tên';
    const key = `${serviceType}\u0000${session.minutes}`;
    const group = groups.get(key);
    if (group) group.visits += 1;
    else groups.set(key, { serviceType, minutes: session.minutes, visits: 1 });
  }
  return [...groups.values()].sort((a, b) =>
    a.serviceType.localeCompare(b.serviceType, 'vi') || a.minutes - b.minutes,
  );
}

export function serviceDurationLabel(detail: ServiceDurationDetail, formatMinutes: (minutes: number) => string) {
  return `${detail.serviceType} · ${detail.visits} ca × ${formatMinutes(detail.minutes)}`;
}

export function serviceHoursLabel(detail: ServiceHoursDetail, formatMinutes: (minutes: number) => string) {
  return `${detail.serviceType} · ${formatMinutes(detail.minutes)}`;
}
