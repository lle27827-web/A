const RETENTION_YEARS = 5;

function vietnamDateParts(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/** The inclusive cutoff date, measured as five rolling years in Vietnam time. */
export function retentionCutoffDate(now = new Date()): string {
  const today = vietnamDateParts(now);
  const year = today.year - RETENTION_YEARS;
  const lastDay = new Date(Date.UTC(year, today.month, 0)).getUTCDate();
  const day = Math.min(today.day, lastDay);
  return `${year}-${String(today.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isWithinRetention(date: string, now = new Date()): boolean {
  return date >= retentionCutoffDate(now);
}
