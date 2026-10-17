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

export type ServiceHoursDifference = {
  serviceName: string;
  personalMinutes: number;
  referenceMinutes: number;
};

export function compareServiceHours(personal: PersonalComparisonVisit[], reference: PersonalComparisonVisit[]): ServiceHoursDifference[] {
  const aggregate = (visits: PersonalComparisonVisit[]) => {
    const groups = new Map<string, { serviceName: string; minutes: number }>();
    for (const visit of visits) {
      const serviceName = visit.serviceName.normalize('NFC').trim().replace(/\s+/g, ' ');
      const key = serviceName.toLocaleLowerCase('vi');
      const group = groups.get(key) ?? { serviceName, minutes: 0 };
      group.minutes += visit.minutes;
      groups.set(key, group);
    }
    return groups;
  };

  const personalGroups = aggregate(personal);
  const referenceGroups = aggregate(reference);
  return [...new Set([...personalGroups.keys(), ...referenceGroups.keys()])]
    .map((key) => ({
      serviceName: personalGroups.get(key)?.serviceName ?? referenceGroups.get(key)!.serviceName,
      personalMinutes: personalGroups.get(key)?.minutes ?? 0,
      referenceMinutes: referenceGroups.get(key)?.minutes ?? 0,
    }))
    .filter((group) => group.personalMinutes !== group.referenceMinutes)
    .sort((a, b) => a.serviceName.localeCompare(b.serviceName, 'vi'));
}

export function comparisonResult(personalCount: number, referenceCount: number, unmatchedCount: number) {
  if (unmatchedCount > 0) return 'mismatches' as const;
  if (personalCount === 0 && referenceCount === 0) return 'empty' as const;
  return 'matched' as const;
}
