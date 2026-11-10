import { db } from "@workspace/db";
import { isWithinRetention, retentionCutoffDate } from "./retention-window";

export class MassageError extends Error {
  constructor(public status: number, message: string, public details?: { mergeTargetId: number }) {
    super(message);
  }
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function validDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9998) {
    throw new MassageError(400, "Ngày không hợp lệ.");
  }
  return value;
}

export function monthBounds(month: string) {
  const start = validDate(`${month}-01`);
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return { start, end: date.toISOString().slice(0, 10) };
}

export function retainedDate(value: string) {
  const date = validDate(value);
  if (!isWithinRetention(date)) throw new MassageError(400, "Chỉ xem và ghi lịch sử trong 5 năm gần nhất.");
  return date;
}

export function retainedMonthBounds(month: string) {
  const bounds = monthBounds(month);
  const cutoff = retentionCutoffDate();
  if (bounds.end <= cutoff) throw new MassageError(400, "Chỉ xem lịch sử trong 5 năm gần nhất.");
  return { ...bounds, start: bounds.start < cutoff ? cutoff : bounds.start };
}

export function currentBusinessDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const identityText = (value: string) => value
  .normalize("NFC")
  .replace(/[\s\u200b\u2060\ufeff]+/gu, " ")
  .trim()
  .toLowerCase();

export const validIdentityPhone = (value: string) => {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0084") && digits.length === 13) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("84") && digits.length === 11) digits = `0${digits.slice(2)}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
};

export const identityPhone = (value: string) =>
  validIdentityPhone(value) ?? (value.replace(/\D/g, "") || identityText(value));

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
