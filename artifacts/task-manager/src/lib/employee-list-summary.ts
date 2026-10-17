import type { ServiceSession } from '@workspace/api-client-react';

export type ServiceCount = { serviceType: string; count: number };
export type EmployeeListSummary = {
  monthEarnings: number;
  monthSessionCount: number;
  monthServices: ServiceCount[];
  dayEarnings: number;
  daySessionCount: number;
  dayServices: ServiceCount[];
};

type MutableSummary = {
  monthEarnings: number;
  monthSessionCount: number;
  monthServices: Map<string, number>;
  dayEarnings: number;
  daySessionCount: number;
  dayServices: Map<string, number>;
};

function addService(services: Map<string, number>, serviceType: string) {
  const label = serviceType.trim() || 'Không tên';
  services.set(label, (services.get(label) ?? 0) + 1);
}

function sortedCounts(services: Map<string, number>): ServiceCount[] {
  return [...services.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'vi'))
    .map(([serviceType, count]) => ({ serviceType, count }));
}

export function summarizeEmployeeSessions(sessions: ServiceSession[], day: string): Map<number, EmployeeListSummary> {
  const summaries = new Map<number, MutableSummary>();
  for (const session of sessions) {
    if (session.memberId === null) continue;
    let summary = summaries.get(session.memberId);
    if (!summary) {
      summary = {
        monthEarnings: 0, monthSessionCount: 0, monthServices: new Map(),
        dayEarnings: 0, daySessionCount: 0, dayServices: new Map(),
      };
      summaries.set(session.memberId, summary);
    }

    summary.monthEarnings += session.earnings;
    summary.monthSessionCount += 1;
    addService(summary.monthServices, session.serviceType);
    if (session.workDate === day) {
      summary.dayEarnings += session.earnings;
      summary.daySessionCount += 1;
      addService(summary.dayServices, session.serviceType);
    }
  }

  return new Map([...summaries.entries()].map(([memberId, summary]) => [memberId, {
    monthEarnings: summary.monthEarnings,
    monthSessionCount: summary.monthSessionCount,
    monthServices: sortedCounts(summary.monthServices),
    dayEarnings: summary.dayEarnings,
    daySessionCount: summary.daySessionCount,
    dayServices: sortedCounts(summary.dayServices),
  }]));
}
