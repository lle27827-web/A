export function vietnamToday(now = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
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
  const requestedMonth = params.get('month') ?? '';
  const validMonth = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(requestedMonth) && requestedMonth <= currentMonth;
  const month = validMonth ? requestedMonth : currentMonth;
  const maxDate = month === currentMonth ? today : monthLastDate(month);
  const requestedDate = params.get('date') ?? '';
  const validDate = /^\d{4}-\d{2}-(0[1-9]|[12]\d|3[01])$/.test(requestedDate)
    && requestedDate.slice(0, 7) === month && requestedDate <= maxDate;
  return {
    month, date: validDate ? requestedDate : maxDate, maxDate, currentMonth,
    isHistory: validMonth || params.has('date'),
  };
}
