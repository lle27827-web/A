export function treatmentCardLimitError(totalMinutes: number, amount: number): string | null {
  if (totalMinutes > 600_000) return 'Tổng số giờ của thẻ không được vượt quá 10.000 giờ.';
  if (amount > 1_000_000_000) return 'Số tiền thẻ không được vượt quá 1 tỷ đồng.';
  return null;
}
