import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideBusinessRoleOnboarding,
  hasCompletedBusinessRoleOnboarding,
  readBusinessRolePreference,
  shouldShowBusinessJoinForm,
} from './business-role-preference';

test('the business join form is only shown to employees with no linked business', () => {
  assert.equal(shouldShowBusinessJoinForm('employee', 0), true);
  assert.equal(shouldShowBusinessJoinForm('employee', 1), false);
  assert.equal(shouldShowBusinessJoinForm('employee', 2), false);
  assert.equal(shouldShowBusinessJoinForm('owner', 0), false);
  assert.equal(shouldShowBusinessJoinForm('personal', 0), false);
  assert.equal(shouldShowBusinessJoinForm(null, 0), false);
});

test('a new account sees role selection and defaults to its personal notebook', () => {
  assert.deepEqual(decideBusinessRoleOnboarding({
    completed: false,
    savedRole: null,
    hasExistingBusiness: false,
    hasOwnerWorkspace: false,
  }), {
    showChooser: true,
    preferredRole: 'personal',
    markComplete: false,
  });
});

test('an unfinished role choice resumes on the saved choice', () => {
  assert.deepEqual(decideBusinessRoleOnboarding({
    completed: false,
    savedRole: 'employee',
    hasExistingBusiness: false,
    hasOwnerWorkspace: false,
  }), {
    showChooser: true,
    preferredRole: 'employee',
    markComplete: false,
  });
});

test('existing business accounts see the role chooser once, defaulting to their current kind of role', () => {
  assert.deepEqual(decideBusinessRoleOnboarding({
    completed: false,
    savedRole: null,
    hasExistingBusiness: true,
    hasOwnerWorkspace: true,
  }), {
    showChooser: true,
    preferredRole: 'owner',
    markComplete: false,
  });
  assert.deepEqual(decideBusinessRoleOnboarding({
    completed: false,
    savedRole: null,
    hasExistingBusiness: true,
    hasOwnerWorkspace: false,
  }), {
    showChooser: true,
    preferredRole: 'employee',
    markComplete: false,
  });
});

test('a completed personal choice stays personal on the next login', () => {
  assert.deepEqual(decideBusinessRoleOnboarding({
    completed: true,
    savedRole: 'personal',
    hasExistingBusiness: false,
    hasOwnerWorkspace: false,
  }), {
    showChooser: false,
    preferredRole: 'personal',
    markComplete: false,
  });
});

test('the updated onboarding version can show role selection to an existing signed-in account', () => {
  const store = new Map<string, string>([
    ['so-cong:role-onboarding-complete:user-1', 'true'],
    ['so-cong:role-choice:user-1', 'employee'],
  ]);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => store.get(key) ?? null } },
  });
  try {
    assert.equal(hasCompletedBusinessRoleOnboarding('user-1'), false);
    assert.deepEqual(decideBusinessRoleOnboarding({
      completed: hasCompletedBusinessRoleOnboarding('user-1'),
      savedRole: readBusinessRolePreference('user-1'),
      hasExistingBusiness: true,
      hasOwnerWorkspace: false,
    }), {
      showChooser: true,
      preferredRole: 'employee',
      markComplete: false,
    });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
