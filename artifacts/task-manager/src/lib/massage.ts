import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMassageSummaryQueryKey,
  getGetMemberPayrollQueryKey,
  getListMembersQueryKey,
  getListServiceTypesQueryKey,
  getListServiceSessionsQueryKey,
  getListTreatmentCardsQueryKey,
} from '@workspace/api-client-react';
import { statusCode } from '@/lib/attendance';

const vnd = new Intl.NumberFormat('vi-VN');
export function formatVnd(n: number) { return `${vnd.format(Math.round(n))} ₫`; }

export function formatMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}
export function hoursValue(min: number) { return String(Math.round((min / 60) * 100) / 100).replace('.', ','); }

/** Parses "1,5" or "1.5" hours into integer minutes; returns null if invalid. */
export function parseHoursToMinutes(text: string): number | null {
  const value = text.trim();
  if (!/^(?:\d+|\d*[.,]\d+)$/.test(value)) return null;
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const minutes = Math.round(n * 60);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}
export function parseMoney(text: string): number | null {
  const value = text.trim().replace(/\s*(?:₫|đ|vnd)$/i, '').trim();
  if (!/^\d+(?:[.,\s]\d{3})*$/.test(value)) return null;
  const amount = Number(value.replace(/[.,\s]/g, ''));
  return Number.isSafeInteger(amount) ? amount : null;
}

export function monthOf(date: string) { return date.slice(0, 7); }
export function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function formatMonth(month: string) {
  const [y, m] = month.split('-');
  return `Tháng ${Number(m)}/${y}`;
}
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export function weekday(date: string) { return WEEKDAYS[new Date(`${date}T00:00:00`).getDay()]; }

export function errorText(error: unknown, fallback = 'Chưa thể lưu thay đổi. Vui lòng thử lại.') {
  const status = statusCode(error);
  const data = error && typeof error === 'object' ? (error as { data?: unknown }).data : null;
  const serverMsg = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : '';
  if (status === 401 || status === 403) return serverMsg || 'Quyền thay đổi không còn hiệu lực. Hãy đăng nhập lại bằng tài khoản chủ sở hữu.';
  return serverMsg || fallback;
}

export function useRefreshMassage() {
  const cache = useQueryClient();
  return (opts: { members?: boolean; services?: boolean } = {}) => {
    void cache.invalidateQueries({ queryKey: getListTreatmentCardsQueryKey() });
    void cache.invalidateQueries({ queryKey: getListServiceSessionsQueryKey() });
    void cache.invalidateQueries({ queryKey: getGetMassageSummaryQueryKey() });
    void cache.invalidateQueries({ queryKey: getGetMemberPayrollQueryKey() });
    if (opts.services) void cache.invalidateQueries({ queryKey: getListServiceTypesQueryKey() });
    if (opts.members) void cache.invalidateQueries({ queryKey: getListMembersQueryKey() });
  };
}

export const SESSION_FRESHNESS = { staleTime: 20_000, refetchOnWindowFocus: true, refetchInterval: 60_000 } as const;
