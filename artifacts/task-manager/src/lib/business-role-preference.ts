export type BusinessRolePreference = 'personal' | 'owner' | 'employee';

const roleKey = (userId: string) => `so-cong:role-choice:${userId}`;
const onboardingKey = (userId: string) => `so-cong:role-onboarding-complete:v2:${userId}`;

export function shouldShowBusinessJoinForm(role: BusinessRolePreference | null, linkedBusinessCount: number): boolean {
  return role === 'employee' && linkedBusinessCount === 0;
}

export function decideBusinessRoleOnboarding(input: {
  completed: boolean;
  savedRole: BusinessRolePreference | null;
  hasExistingBusiness: boolean;
  hasOwnerWorkspace: boolean;
}): { showChooser: boolean; preferredRole: BusinessRolePreference | null; markComplete: boolean } {
  if (input.completed) {
    return { showChooser: false, preferredRole: input.savedRole, markComplete: false };
  }
  return {
    showChooser: true,
    preferredRole: input.savedRole ?? (
      input.hasExistingBusiness
        ? input.hasOwnerWorkspace ? 'owner' : 'employee'
        : 'personal'
    ),
    markComplete: false,
  };
}

export function readBusinessRolePreference(userId: string | null | undefined): BusinessRolePreference | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(roleKey(userId));
    return value === 'personal' || value === 'owner' || value === 'employee' ? value : null;
  } catch {
    return null;
  }
}

export function saveBusinessRolePreference(
  userId: string | null | undefined,
  role: BusinessRolePreference,
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(roleKey(userId), role);
  } catch {
    // Role choice is a convenience only; server authorization stays authoritative.
  }
}

export function hasCompletedBusinessRoleOnboarding(userId: string | null | undefined): boolean {
  if (!userId || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(onboardingKey(userId)) === 'true';
  } catch {
    return false;
  }
}

export function completeBusinessRoleOnboarding(userId: string | null | undefined): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(onboardingKey(userId), 'true');
  } catch {
    // The onboarding can still complete for the active session if storage is disabled.
  }
}
