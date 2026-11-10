import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blockedShortcutReason,
  readDeviceShortcutBindings,
  readDeviceShortcutLabels,
  shortcutFromKeyboardEvent,
  writeDeviceShortcutBindings,
  writeDeviceShortcutLabels,
} from './keyboard-shortcuts';

function withFakeWindow<T>(callback: (values: Map<string, string>) => T): T {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
    dispatchEvent: () => true,
  } as unknown as Window;

  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  try {
    return callback(values);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

function keyEvent(overrides: Partial<KeyboardEvent> = {}): Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'> {
  return {
    key: 'k',
    code: 'KeyK',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

test('records Alt shortcuts and identifies the physical number key with Shift', () => {
  assert.equal(shortcutFromKeyboardEvent(keyEvent({ altKey: true })), 'Alt+K');
  assert.equal(shortcutFromKeyboardEvent(keyEvent({
    key: '!',
    code: 'Digit1',
    ctrlKey: true,
    shiftKey: true,
  })), 'Ctrl+Shift+1');
  assert.equal(shortcutFromKeyboardEvent(keyEvent()), null);
});

test('rejects system, browser, and screen-reader shortcut combinations', () => {
  assert.match(blockedShortcutReason('Ctrl+Alt+H') ?? '', /VoiceOver/);
  assert.match(blockedShortcutReason('Meta+K') ?? '', /trợ năng/);
  assert.match(blockedShortcutReason('Alt+Shift+1') ?? '', /ngôn ngữ bàn phím/);
  assert.match(blockedShortcutReason('Ctrl+S') ?? '', /trình duyệt/);
  assert.match(blockedShortcutReason('Ctrl+Shift+K') ?? '', /trình duyệt/);
  assert.match(blockedShortcutReason('Alt+F') ?? '', /menu/);
  assert.equal(blockedShortcutReason('Alt+1'), null);
  assert.equal(blockedShortcutReason('Ctrl+Shift+1'), null);
});

test('stores normalized bindings locally and drops duplicate combinations', () => {
  withFakeWindow(() => {
    assert.equal(writeDeviceShortcutBindings([
      { id: 'first', actionId: 'first', combination: 'Shift+Ctrl+1' },
      { id: 'duplicate', actionId: 'second', combination: 'Ctrl+Shift+1' },
      { id: 'invalid', actionId: 'third', combination: 'Ctrl+S' },
    ]), true);
    assert.deepEqual(readDeviceShortcutBindings(), [
      { id: 'first', actionId: 'first', combination: 'Ctrl+Shift+1' },
    ]);
  });
});

test('does not migrate ambiguous global bindings into a tenant scope', () => {
  withFakeWindow((values) => {
    values.set('so-cong:keyboard-shortcuts:v1', JSON.stringify({
      'employee-attendance-7': 'Alt+1',
    }));
    assert.deepEqual(readDeviceShortcutBindings('owner-1:business-a'), []);
    assert.equal(values.has('so-cong:keyboard-shortcuts:v1'), false);

    const multiple = [
      { id: 'binding-one', actionId: 'employee-attendance-7', combination: 'Alt+1' },
      { id: 'binding-two', actionId: 'employee-attendance-7', combination: 'Alt+2' },
      { id: 'binding-three', actionId: 'new-appointment', combination: 'Ctrl+Shift+3' },
    ];
    assert.equal(writeDeviceShortcutBindings(multiple), true);
    assert.deepEqual(readDeviceShortcutBindings(), multiple);
  });
});

test('keeps labels only for assigned screen actions on this device', () => {
  withFakeWindow(() => {
    writeDeviceShortcutLabels([
      { id: 'ui-a1', label: 'Thêm lịch hẹn', run: () => undefined },
      { id: 'ui-b2', label: 'Xóa nhân viên Mai', run: () => undefined },
    ], [{ id: 'binding-a', actionId: 'ui-a1', combination: 'Alt+A' }]);
    assert.deepEqual(readDeviceShortcutLabels(), { 'ui-a1': 'Thêm lịch hẹn' });
  });
});

test('bindings and employee labels cannot be read from another business scope', () => {
  withFakeWindow(() => {
    const scopeA = 'owner-1:business-a';
    const scopeB = 'owner-1:business-b';
    const binding = { id: 'binding-a', actionId: 'attendance-employee-17', combination: 'Alt+A' };
    writeDeviceShortcutBindings([binding], scopeA);
    writeDeviceShortcutLabels([
      { id: binding.actionId, label: 'Chấm công nhân viên A', run: () => undefined },
    ], [binding], scopeA);

    assert.deepEqual(readDeviceShortcutBindings(scopeA), [binding]);
    assert.deepEqual(readDeviceShortcutBindings(scopeB), []);
    assert.equal(readDeviceShortcutLabels(scopeA)[binding.actionId], 'Chấm công nhân viên A');
    assert.deepEqual(readDeviceShortcutLabels(scopeB), {});
  });
});
