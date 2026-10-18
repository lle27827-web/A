import { timingSafeEqual } from "node:crypto";

export function isValidRetentionCronAuthorization(
  authorization: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
