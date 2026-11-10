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

export function retentionCronAuthorizationStatus(
  authorization: string | undefined,
  secret: string | undefined,
): 200 | 401 | 503 {
  const configuredSecret = secret?.trim();
  if (!configuredSecret) return 503;
  return isValidRetentionCronAuthorization(authorization, configuredSecret) ? 200 : 401;
}
