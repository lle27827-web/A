export function getApiErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const data = (error as { data?: unknown }).data;
  if (data && typeof data === 'object') {
    const body = data as Record<string, unknown>;
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
  }

  if (error instanceof Error) {
    const message = error.message.replace(/^HTTP \d{3}[^:]*:\s*/, '').trim();
    return message || null;
  }
  return null;
}
