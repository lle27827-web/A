import type { ServiceSession } from '@workspace/api-client-react';
import { summarizeServiceDurations, type ServiceDurationDetail } from './service-duration-summary';

export type ServiceCount = ServiceDurationDetail;
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
  monthSessions: { serviceType: string; minutes: number }[];
  dayEarnings: number;
  daySessionCount: number;
  daySessions: { serviceType: string; minutes: number }[];
};

export function summarizeEmployeeSessions(sessions: ServiceSession[], day: string): Map<number, EmployeeListSummary> {
  const summaries = new Map<number, MutableSummary>();
  for (const session of sessions) {
    if (session.memberId === null) continue;
    let summary = summaries.get(session.memberId);
    if (!summary) {
      summary = {
        monthEarnings: 0, monthSessionCount: 0, monthSessions: [],
        dayEarnings: 0, daySessionCount: 0, daySessions: [],
      };
      summaries.set(session.memberId, summary);
    }

    summary.monthEarnings += session.earnings;
    summary.monthSessionCount += 1;
    summary.monthSessions.push(session);
    if (session.workDate === day) {
      summary.dayEarnings += session.earnings;
      summary.daySessionCount += 1;
      summary.daySessions.push(session);
    }
  }

  return new Map([...summaries.entries()].map(([memberId, summary]) => [memberId, {
    monthEarnings: summary.monthEarnings,
    monthSessionCount: summary.monthSessionCount,
    monthServices: summarizeServiceDurations(summary.monthSessions),
    dayEarnings: summary.dayEarnings,
    daySessionCount: summary.daySessionCount,
    dayServices: summarizeServiceDurations(summary.daySessions),
  }]));
}
