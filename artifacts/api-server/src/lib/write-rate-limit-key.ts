export function writeRateLimitKey(email: string | null | undefined, ip: string | null | undefined): string {
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail) return `account:${normalizedEmail}`;
  return `ip:${ip || "unknown"}`;
}
