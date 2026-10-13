type EmailAddress = { emailAddress: string; verification?: { status: string } | null };

export const canonicalEmail = (email: string) => email.trim().toLowerCase();

export function verifiedAccountEmails(addresses: EmailAddress[]) {
  return addresses.filter((address) => address.verification?.status === "verified")
    .map((address) => canonicalEmail(address.emailAddress));
}

export function resolvePermissions(ownerEmail: string | undefined, emails: string[], grants: string[]) {
  const owner = ownerEmail ? canonicalEmail(ownerEmail) : "";
  const ownerConfigured = Boolean(owner);
  const verified = emails.map(canonicalEmail);
  const isOwner = ownerConfigured && verified.includes(owner);
  const canManage = ownerConfigured && (isOwner || grants.some((email) => verified.includes(canonicalEmail(email))));
  return { ownerConfigured, isOwner, canManage };
}
