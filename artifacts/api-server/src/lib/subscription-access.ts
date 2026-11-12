export type SubscriptionAccessState =
  | "free"
  | "trial"
  | "paid"
  | "manual"
  | "expired"
  | "blocked"
  | "verification_required";

export type SubscriptionAccessRow = {
  trial_started_at?: Date | string | null;
  trial_ends_at?: Date | string | null;
  paid_until?: Date | string | null;
  manual_access?: boolean | null;
};

function asTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function resolveSubscriptionAccess(
  row: SubscriptionAccessRow | null,
  billingEnabled: boolean,
  now = Date.now(),
): {
  billingEnabled: boolean;
  accessAllowed: boolean;
  status: SubscriptionAccessState;
  trialStartedAt: Date | string | null;
  trialEndsAt: Date | string | null;
  paidUntil: Date | string | null;
  manualAccess: boolean | null;
} {
  const accessRow = row ?? {};
  let status: SubscriptionAccessState;
  let accessAllowed: boolean;

  if (accessRow.manual_access === false) {
    status = "blocked";
    accessAllowed = false;
  } else if (accessRow.manual_access === true) {
    status = "manual";
    accessAllowed = true;
  } else if (!billingEnabled) {
    status = "free";
    accessAllowed = true;
  } else {
    const paidUntil = asTime(accessRow.paid_until);
    const trialEndsAt = asTime(accessRow.trial_ends_at);
    if (paidUntil !== null && paidUntil > now) {
      status = "paid";
      accessAllowed = true;
    } else if (trialEndsAt !== null && trialEndsAt > now) {
      status = "trial";
      accessAllowed = true;
    } else if (trialEndsAt === null) {
      // A new account with no trial record must not be locked before its first
      // verified login creates the trial row.
      status = "free";
      accessAllowed = true;
    } else {
      status = "expired";
      accessAllowed = false;
    }
  }

  return {
    billingEnabled,
    accessAllowed,
    status,
    trialStartedAt: accessRow.trial_started_at ?? null,
    trialEndsAt: accessRow.trial_ends_at ?? null,
    paidUntil: accessRow.paid_until ?? null,
    manualAccess: accessRow.manual_access ?? null,
  };
}
