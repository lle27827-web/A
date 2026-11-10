export function isMalformedJsonBodyError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "type" in error &&
    error.type === "entity.parse.failed",
  );
}
