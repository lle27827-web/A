import type { MemberRecord, PersonalComparisonVisit } from '@workspace/api-client-react';

const normalize = (text: string) => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');

export function comparisonMemberParams(month: string, currentMonth: string) {
  return month < currentMonth ? { month } : undefined;
}

export function comparisonRoster(rows: MemberRecord[]) {
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  const names = new Map<string, number>();
  for (const row of unique) names.set(normalize(row.name), (names.get(normalize(row.name)) ?? 0) + 1);
  return unique.map((row) => ({
    ...row,
    label: `${row.name}${(names.get(normalize(row.name)) ?? 0) > 1 ? ` · #${row.id}` : ''}${row.deletedAt ? ' · Đã nghỉ' : ''}`,
  }));
}

export function visitGroups(rows: PersonalComparisonVisit[], detailed = false) {
  const groups = new Map<string, { service: string; customer: string; count: number; minutes: number; earnings: number; eachMinutes: number; eachPay: number }>();
  for (const row of rows) {
    const key = JSON.stringify([normalize(row.serviceName), ...(detailed ? [row.minutes, row.earnings, normalize(row.customerName)] : [])]);
    const group = groups.get(key) ?? { service: row.serviceName, customer: detailed ? row.customerName : '', count: 0, minutes: 0, earnings: 0, eachMinutes: row.minutes, eachPay: row.earnings };
    group.count++;
    group.minutes += row.minutes;
    group.earnings += row.earnings;
    groups.set(key, group);
  }
  return [...groups.values()];
}
