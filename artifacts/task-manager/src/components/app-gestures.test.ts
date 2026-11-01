/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachAppTouchGestures,
  appTouchGestureForPath,
  isSafeAppSaveLabel,
  isSafeLongPressSaveTarget,
  previousAppLocation,
} from './app-gestures.ts';

test('one continuous up-right-left path saves', () => {
  assert.equal(appTouchGestureForPath([
    { x: 160, y: 220 },
    { x: 160, y: 170 },
    { x: 160, y: 120 },
    { x: 210, y: 120 },
    { x: 270, y: 120 },
    { x: 220, y: 120 },
  ]), 'save');
});

test('one continuous left-right path returns', () => {
  assert.equal(appTouchGestureForPath([
    { x: 220, y: 100 },
    { x: 170, y: 100 },
    { x: 115, y: 100 },
    { x: 175, y: 100 },
  ]), 'back');
});

test('ordinary swipes and unclear paths do nothing', () => {
  assert.equal(appTouchGestureForPath([{ x: 20, y: 80 }, { x: 20, y: 20 }]), null);
  assert.equal(appTouchGestureForPath([{ x: 180, y: 100 }, { x: 100, y: 100 }, { x: 40, y: 100 }]), null);
  assert.equal(appTouchGestureForPath([
    { x: 160, y: 220 },
    { x: 160, y: 170 },
    { x: 160, y: 120 },
    { x: 220, y: 120 },
  ]), null);
});

test('save only targets normal form actions, not destructive or financial controls', () => {
  for (const label of ['Lưu', 'Lưu ca', 'Ghi nhận', 'Tạo nhân viên', 'Cập nhật']) {
    assert.equal(isSafeAppSaveLabel(label), true, label);
  }
  for (const label of ['Xóa lịch sử', 'Nạp thẻ', 'Xác nhận', 'Chuyển database']) {
    assert.equal(isSafeAppSaveLabel(label), false, label);
  }
});

test('two-second hold may submit only a visible attendance form action', () => {
  assert.equal(isSafeLongPressSaveTarget('attendance', 'Lưu ca'), true);
  assert.equal(isSafeLongPressSaveTarget('attendance', 'Ghi nhận ca'), true);
  assert.equal(isSafeLongPressSaveTarget('card-topup', 'Nạp thẻ'), false);
  assert.equal(isSafeLongPressSaveTarget('history', 'Xóa lịch sử'), false);
  assert.equal(isSafeLongPressSaveTarget('attendance', 'Xác nhận'), false);
  assert.equal(isSafeLongPressSaveTarget(null, 'Lưu ca'), false);
});

test('a stationary two-second hold starts even over an input field', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  const listeners = new Map<string, (event: Event) => void>();
  let scheduledDelay = 0;
  let timerCallback: (() => void) | null = null;
  let saved = 0;

  class FakeInput {
    closest() { return this; }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: (callback: () => void, delay: number) => {
        scheduledDelay = delay;
        timerCallback = callback;
        return 1;
      },
      clearTimeout: () => {},
    },
  });
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: FakeInput });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.set(type, typeof listener === 'function'
          ? listener as (event: Event) => void
          : (event) => listener.handleEvent(event));
      },
      removeEventListener: () => {},
    },
  });

  try {
    const detach = attachAppTouchGestures({
      onGesture: () => assert.fail('Holding still should not be interpreted as a swipe.'),
      onLongPressSave: () => { saved += 1; return true; },
    });
    const touchStart = listeners.get('touchstart');
    assert.ok(touchStart);
    touchStart({
      target: new FakeInput(),
      touches: {
        length: 1,
        item: () => ({ identifier: 1, clientX: 120, clientY: 180 }),
      },
    } as unknown as Event);
    assert.equal(scheduledDelay, 2_000);
    assert.ok(timerCallback);
    timerCallback();
    assert.equal(saved, 1);
    detach();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (originalElement) Object.defineProperty(globalThis, 'Element', originalElement);
    else Reflect.deleteProperty(globalThis, 'Element');
  }
});

test('back follows route history and falls back from direct detail links', () => {
  const firstBack = previousAppLocation(['/', '/cards', '/cards/12'], '/cards/12');
  assert.deepEqual(firstBack, { target: '/cards', history: ['/', '/cards'] });
  assert.deepEqual(previousAppLocation([], '/employees/7?month=2026-10'), {
    target: '/employees?month=2026-10',
    history: ['/employees?month=2026-10'],
  });
  assert.deepEqual(previousAppLocation(['/'], '/'), { target: null, history: ['/'] });
});
