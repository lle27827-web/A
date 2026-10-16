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

export function discrepancyPairs(personal: PersonalComparisonVisit[], reference: PersonalComparisonVisit[]) {
  return Array.from({ length: Math.max(personal.length, reference.length) }, (_, index) => ({
    personal: personal[index] ?? null,
    reference: reference[index] ?? null,
  }));
}

export function comparisonResult(personalCount: number, referenceCount: number, unmatchedCount: number) {
  if (unmatchedCount > 0) return 'mismatches' as const;
  if (personalCount === 0 && referenceCount === 0) return 'empty' as const;
  return 'matched' as const;
}
