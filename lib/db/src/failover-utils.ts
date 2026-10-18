export function isDatabaseCapacityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "53100") return true;

  return (
    typeof candidate.message === "string" &&
    /no space left on device|database(?: or disk)? is full|disk full/i.test(
      candidate.message,
    )
  );
}

export function parseDatabaseCapacityLimit(value: string | undefined): bigint | null {
  if (value === undefined || value.trim() === "") return null;
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error("DATABASE_URL_1_MAX_BYTES must be a positive integer.");
  }
  return BigInt(normalized);
}

export function hasReachedDatabaseCapacity(
  usedBytes: string | bigint,
  limitBytes: bigint,
): boolean {
  return BigInt(usedBytes) >= limitBytes;
}
