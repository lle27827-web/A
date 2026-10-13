import type { AttendanceRecord, AttendanceStatus } from '@workspace/api-client-react';

export const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Có mặt' },
  { value: 'late', label: 'Đi muộn' },
  { value: 'absent', label: 'Vắng' },
  { value: 'leave', label: 'Nghỉ phép' },
];

export function statusLabel(status: AttendanceStatus) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status;
}

export function localDate() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatDate(date: string) {
  if (!date) return 'Chưa chọn ngày';
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T00:00:00`));
}

export function formatShortDate(date: string) {
  const [y, m, d] = date.split('-');
  return d && m && y ? `${d}/${m}/${y}` : date;
}

export function normalize(text: string) {
  return text.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
}

export function recordMatches(record: AttendanceRecord, query: string) {
  const q = normalize(query);
  if (!q) return true;
  const haystack = [record.employeeName, record.note ?? '', record.workDate, formatShortDate(record.workDate), record.checkIn ?? '', record.checkOut ?? '', statusLabel(record.status)].map(normalize).join(' | ');
  return haystack.includes(q);
}

export function initial(name: string) {
  return name.trim().slice(0, 1).toLocaleUpperCase('vi') || '?';
}

export function statusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const maybe = error as { status?: number; response?: { status?: number }; statusCode?: number };
  return maybe.status ?? maybe.response?.status ?? maybe.statusCode ?? null;
}

export function messageFromError(error: unknown) {
  const status = statusCode(error);
  if (status === 401 || status === 403) return 'Quyền thay đổi không còn hiệu lực. Hãy đăng nhập lại bằng tài khoản chủ sở hữu.';
  return 'Chưa thể lưu thay đổi. Vui lòng thử lại.';
}
