const GMAIL_SUFFIX = '@gmail.com';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GMAIL_ACCOUNT_NAME = /^[a-z0-9](?:[a-z0-9.]*[a-z0-9])?$/;

/** Accepts either a Gmail account name or a pasted full Gmail address. */
export function normalizeManagerGrantEmail(value: string, isNewGrant: boolean): string | null {
  const normalized = value.trim().toLowerCase();
  if (!isNewGrant) {
    return normalized.length <= 254 && EMAIL.test(normalized) ? normalized : null;
  }

  const accountName = normalized.endsWith(GMAIL_SUFFIX)
    ? normalized.slice(0, -GMAIL_SUFFIX.length)
    : normalized;

  if (
    accountName.length > 64
    || accountName.includes('..')
    || !GMAIL_ACCOUNT_NAME.test(accountName)
  ) {
    return null;
  }

  const email = `${accountName}${GMAIL_SUFFIX}`;
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export function hasDuplicateManagerGrantEmail(email: string, existingEmails: readonly string[]): boolean {
  const normalized = email.trim().toLowerCase();
  return existingEmails.some((existing) => existing.trim().toLowerCase() === normalized);
}

/** Keeps a pasted full Gmail address from showing the fixed suffix twice. */
export function managerGrantEmailInputValue(value: string, isNewGrant: boolean): string {
  if (!isNewGrant) return value;
  const trimmed = value.trim();
  return trimmed.toLowerCase().endsWith(GMAIL_SUFFIX)
    ? trimmed.slice(0, -GMAIL_SUFFIX.length)
    : value;
}
