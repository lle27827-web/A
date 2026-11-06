export type BonusPaySettings = {
  enabled: boolean;
  thresholdMinutes: number;
};

export type BonusPayInput = BonusPaySettings & {
  minutesWorkedEarlierThisMonth: number;
  standardHourlyRate: number;
  bonusHourlyRate: number | null | undefined;
};

export function shouldKeepRecordedHourlyRate(
  old: { memberId: number | null; serviceTypeId: number | null; hourlyRate: number } | undefined,
  memberId: number,
  serviceTypeId: number | null,
): boolean {
  return Boolean(old && old.memberId === memberId && old.serviceTypeId === serviceTypeId && old.hourlyRate > 0);
}

export function monthDateBounds(workDate: string) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(workDate);
  if (!match) throw new Error("Invalid work date.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("Invalid work date.");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

/** The threshold is reached by earlier shifts; the shift that reaches it stays at the standard rate. */
export function chooseEmployeeHourlyRate(input: BonusPayInput): number {
  if (
    input.enabled &&
    input.thresholdMinutes > 0 &&
    input.minutesWorkedEarlierThisMonth >= input.thresholdMinutes &&
    input.bonusHourlyRate !== null &&
    input.bonusHourlyRate !== undefined &&
    input.bonusHourlyRate > input.standardHourlyRate
  ) {
    return input.bonusHourlyRate;
  }
  return input.standardHourlyRate;
}
