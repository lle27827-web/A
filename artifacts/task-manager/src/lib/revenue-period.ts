export function vietnamToday(now = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function followBusinessDay(selectedDate: string, previousToday: string, nextToday: string): string {
  return selectedDate === previousToday ? nextToday : selectedDate;
}

export function previousRevenueMonth(today = vietnamToday()): string {
  const [year, month] = today.split('-').map(Number);
  return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`;
}

export function monthLastDate(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
}

export function resolveRevenuePeriod(search: string, today: string) {
  const params = new URLSearchParams(search);
  const currentMonth = today.slice(0, 7);
  const requestedDate = params.get('date') ?? '';
  // Date-only employee links predate month navigation and must still open
  // that date's roster, rather than silently showing today's employee data.
  const requestedMonth = params.get('month') ?? (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate.slice(0, 7) : '');
  const validMonth = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(requestedMonth) && requestedMonth <= currentMonth;
  const month = validMonth ? requestedMonth : currentMonth;
  const maxDate = month === currentMonth ? today : monthLastDate(month);
  const validDate = /^\d{4}-\d{2}-(0[1-9]|[12]\d|3[01])$/.test(requestedDate)
    && requestedDate.slice(0, 7) === month && requestedDate <= maxDate;
  return {
    month, date: validDate ? requestedDate : maxDate, maxDate, currentMonth,
    isHistory: validMonth || params.has('date'),
  };
}

/** Append month (and optional date) query params to a path, keeping any existing query. */
export function periodHref(path: string, month: string | null, date?: string | null): string {
  const [base, qs = ''] = path.split('?');
  const params = new URLSearchParams(qs);
  if (month) {
    params.set('month', month);
    if (params.get('date')?.slice(0, 7) !== month) {
      if (date && date.slice(0, 7) === month) params.set('date', date);
      else params.delete('date');
    }
  }
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}
