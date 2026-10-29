export const DATABASE_STORAGE_LIMIT_BYTES = 1_000_000_000n;
export const DATABASE_COMPUTE_LIMIT_SECONDS = 100 * 60 * 60;

const CONNECTION_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
]);

const DATABASE_UNAVAILABLE_SQLSTATES = new Set([
  "25006", // read_only_sql_transaction
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
  "58030", // io_error
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);

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

export function isDatabaseAvailabilityError(error: unknown): boolean {
  const inspect = (candidate: unknown, depth: number): boolean => {
    if (!candidate || typeof candidate !== "object" || depth > 4) return false;
    const value = candidate as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof value.code === "string") {
      if (
        value.code.startsWith("08") ||
        value.code.startsWith("58") ||
        CONNECTION_ERROR_CODES.has(value.code)
      ) return true;
      if (DATABASE_UNAVAILABLE_SQLSTATES.has(value.code)) return true;
    }
    if (
      typeof value.message === "string" &&
      /could not connect to server|connection (?:terminated|closed|reset|refused|timed out)|server closed the connection unexpectedly|socket hang up|network is unreachable|no route to host|temporary failure in name resolution|too many clients already|the database system is (?:shutting down|in recovery)|connection acquisition timed out|timeout expired/i.test(
        value.message,
      )
    ) {
      return true;
    }
    return inspect(value.cause, depth + 1);
  };

  return inspect(error, 0);
}

export function isDatabaseFailoverTriggerError(error: unknown): boolean {
  return isDatabaseCapacityError(error) || isDatabaseAvailabilityError(error);
}

export function isSameDatabaseFailureDomain(
  firstConnectionString: string,
  secondConnectionString: string,
): boolean {
  try {
    const getDomain = (connectionString: string) => {
      const url = new URL(connectionString);
      const hostname = url.hostname
        .toLowerCase()
        .replace(/-pooler(?=\.|$)/, "");
      return `${hostname}:${url.port || "5432"}`;
    };
    return getDomain(firstConnectionString) === getDomain(secondConnectionString);
  } catch {
    return false;
  }
}

export function parseDatabaseCapacityLimit(
  value: string | undefined,
  settingName = "DATABASE_URL_1_MAX_BYTES",
): bigint | null {
  if (value === undefined || value.trim() === "") return null;
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${settingName} must be a positive integer.`);
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
