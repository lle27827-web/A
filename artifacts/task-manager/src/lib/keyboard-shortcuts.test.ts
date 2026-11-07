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
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
    dispatchEvent: () => true,
  } as unknown as Window;

  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  try {
    assert.equal(writeDeviceShortcutBindings({
      first: 'Shift+Ctrl+1',
      duplicate: 'Ctrl+Shift+1',
      invalid: 'Ctrl+S',
    }), true);
    assert.deepEqual(readDeviceShortcutBindings(), { first: 'Ctrl+Shift+1' });
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('keeps labels only for assigned screen actions on this device', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
    dispatchEvent: () => true,
  } as unknown as Window;

  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  try {
    writeDeviceShortcutLabels([
      { id: 'ui-a1', label: 'Thêm lịch hẹn', run: () => undefined },
      { id: 'ui-b2', label: 'Xóa nhân viên Mai', run: () => undefined },
    ], { 'ui-a1': 'Alt+A' });
    assert.deepEqual(readDeviceShortcutLabels(), { 'ui-a1': 'Thêm lịch hẹn' });
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
