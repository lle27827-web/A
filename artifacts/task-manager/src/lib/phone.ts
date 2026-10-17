export function phoneCallHref(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 3) return null;
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}
