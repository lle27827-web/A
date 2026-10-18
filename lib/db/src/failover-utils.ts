export const DATABASE_STORAGE_LIMIT_BYTES = 1_000_000_000n;
export const DATABASE_COMPUTE_LIMIT_SECONDS = 100 * 60 * 60;

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

export function parseNeonComputeTimeSeconds(response: unknown): number {
  if (!response || typeof response !== "object") {
    throw new Error("Neon usage response is invalid.");
  }

  const project = (response as { project?: unknown }).project;
  if (!project || typeof project !== "object") {
    throw new Error("Neon usage response is missing project data.");
  }

  const seconds = (project as { compute_time_seconds?: unknown })
    .compute_time_seconds;
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    throw new Error("Neon usage response has invalid compute time.");
  }

  return seconds;
}

export function hasReachedComputeTimeLimit(
  usedSeconds: number,
  limitSeconds = DATABASE_COMPUTE_LIMIT_SECONDS,
): boolean {
  return usedSeconds >= limitSeconds;
}
