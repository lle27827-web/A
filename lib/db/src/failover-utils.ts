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
    if (isDatabasePoolExhaustionError(value)) return false;
    if (typeof value.code === "string") {
      if (
        value.code.startsWith("08") ||
        CONNECTION_ERROR_CODES.has(value.code)
      ) return true;
      if (DATABASE_UNAVAILABLE_SQLSTATES.has(value.code)) return true;
    }
    if (
      typeof value.message === "string" &&
      /could not connect to server|connection (?:terminated|closed|reset|refused|timed out)|server closed the connection unexpectedly|socket hang up|network is unreachable|no route to host|temporary failure in name resolution|the database system is (?:shutting down|in recovery)/i.test(
        value.message,
      )
    ) {
      return true;
    }
    return inspect(value.cause, depth + 1);
  };

  return inspect(error, 0);
}

export function isDatabasePoolExhaustionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (value.code === "53300") return true;
  if (
    typeof value.message === "string" &&
    /connection acquisition timed out|timeout expired|too many clients already/i.test(value.message)
  ) return true;
  return value.cause ? isDatabasePoolExhaustionError(value.cause) : false;
}

export function hasAvailabilityFailureThreshold(
  timestamps: readonly number[],
  now: number,
  limit = 3,
  windowMs = 30_000,
): boolean {
  return timestamps.filter((timestamp) => timestamp >= now - windowMs && timestamp <= now).length >= limit;
}

export function isDatabaseFailoverTriggerError(error: unknown): boolean {
  return isDatabaseAvailabilityError(error);
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
