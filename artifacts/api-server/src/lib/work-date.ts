export const MAX_FUTURE_WORK_DATE_DAYS = 0;

export function isWorkDateWithinFutureLimit(
  workDate: string,
  now = new Date(),
  maxFutureDays = MAX_FUTURE_WORK_DATE_DAYS,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !Number.isSafeInteger(maxFutureDays) || maxFutureDays < 0) {
    return false;
  }
  const parsed = new Date(`${workDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== workDate) return false;

  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const lastAllowed = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  lastAllowed.setUTCDate(lastAllowed.getUTCDate() + maxFutureDays);
  return workDate <= lastAllowed.toISOString().slice(0, 10);
}
