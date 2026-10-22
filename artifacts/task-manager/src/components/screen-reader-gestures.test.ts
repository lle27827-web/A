import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSafeSaveLabel,
  isVietnameseScreenReaderVoice,
  nextScreenReaderFocusIndex,
  previousScreenReaderLocation,
  normalizeSpeechRate,
  normalizeSpeechVolume,
  screenReaderActionForSwipes,
  screenReaderFocusNavigationForSwipe,
  screenReaderKeyboardActionForKey,
} from './screen-reader-gestures.ts';
import {
  isScreenReaderDoubleTap,
  screenReaderTouchShortcutGesture,
  screenReaderTapDecision,
  screenReaderTouchSwipeDirection,
} from './screen-reader-touch-navigation.ts';

test('single upward swipe returns one screen and downward swipe submits a safe form', () => {
  assert.equal(screenReaderActionForSwipes(['up']), 'back');
  assert.equal(screenReaderActionForSwipes(['down']), 'save');
});

test('back navigation unwinds the in-app route stack without looping', () => {
  const firstBack = previousScreenReaderLocation(['/', '/cards', '/cards/12'], '/cards/12');
  assert.deepEqual(firstBack, { target: '/cards', history: ['/', '/cards'] });

  const secondBack = previousScreenReaderLocation(firstBack.history, firstBack.target!);
  assert.deepEqual(secondBack, { target: '/', history: ['/'] });

  const atHome = previousScreenReaderLocation(secondBack.history, secondBack.target!);
  assert.deepEqual(atHome, { target: null, history: ['/'] });
});

test('direct detail links fall back to their list before the home screen', () => {
  const result = previousScreenReaderLocation([], '/employees/7?month=2026-10');
  assert.deepEqual(result, {
    target: '/employees?month=2026-10',
    history: ['/employees?month=2026-10'],
  });
});

test('the screen reader only accepts Vietnamese voices', () => {
  assert.equal(isVietnameseScreenReaderVoice({ lang: 'vi-VN' }), true);
  assert.equal(isVietnameseScreenReaderVoice({ lang: 'VI' }), true);
  assert.equal(isVietnameseScreenReaderVoice({ lang: 'en-US' }), false);
});

test('continuous inverted-V and V gestures map to cards and employees', () => {
  const invertedV = [
    { x: 20, y: 150 },
    { x: 48, y: 92 },
    { x: 72, y: 44 },
    { x: 105, y: 150 },
  ];
  const v = [
    { x: 20, y: 35 },
    { x: 48, y: 92 },
    { x: 72, y: 140 },
    { x: 105, y: 35 },
  ];
  const flat = [
    { x: 20, y: 50 },
    { x: 55, y: 50 },
    { x: 105, y: 50 },
  ];

  assert.deepEqual(screenReaderTouchShortcutGesture(invertedV), ['up', 'down']);
  assert.deepEqual(screenReaderTouchShortcutGesture(v), ['down', 'up']);
  assert.equal(screenReaderTouchShortcutGesture(flat), null);
  assert.equal(screenReaderActionForSwipes(['up', 'down']), 'cards');
  assert.equal(screenReaderActionForSwipes(['down', 'up']), 'employees');
});

test('unknown gesture sequences do nothing', () => {
  assert.equal(screenReaderActionForSwipes([]), null);
  assert.equal(screenReaderActionForSwipes(['up', 'up']), null);
  assert.equal(screenReaderActionForSwipes(['down', 'down']), null);
  assert.equal(screenReaderActionForSwipes(['up', 'down', 'up']), null);
});

test('horizontal swipes map to previous or next, separate from vertical shortcuts', () => {
  assert.equal(screenReaderFocusNavigationForSwipe('left'), 'previous');
  assert.equal(screenReaderFocusNavigationForSwipe('right'), 'next');
  assert.equal(screenReaderFocusNavigationForSwipe('up'), null);
  assert.equal(screenReaderFocusNavigationForSwipe('down'), null);
  assert.equal(screenReaderActionForSwipes(['left']), null);
  assert.equal(screenReaderActionForSwipes(['right']), null);
});

test('touch swipes require a clear direction and ignore short or diagonal movement', () => {
  assert.equal(screenReaderTouchSwipeDirection(-80, 8), 'left');
  assert.equal(screenReaderTouchSwipeDirection(75, -4), 'right');
  assert.equal(screenReaderTouchSwipeDirection(3, -90), 'up');
  assert.equal(screenReaderTouchSwipeDirection(-2, 70), 'down');
  assert.equal(screenReaderTouchSwipeDirection(12, 14), null);
  assert.equal(screenReaderTouchSwipeDirection(45, 40), null);
});

test('double tap is based on timing, not on where the second finger lands', () => {
  assert.equal(isScreenReaderDoubleTap(1_000, 1_500), true);
  assert.equal(isScreenReaderDoubleTap(1_000, 1_750), true);
  assert.equal(isScreenReaderDoubleTap(1_000, 1_751), false);
  assert.equal(isScreenReaderDoubleTap(null, 1_500), false);
  assert.equal(screenReaderTapDecision(null, 1_500), 'focus-touched-target');
  assert.equal(screenReaderTapDecision(1_000, 1_500), 'activate-current-focus');
  assert.equal(screenReaderTapDecision(1_000, 1_751), 'focus-touched-target');
});

test('focus navigation starts at the nearest end and stops at page boundaries', () => {
  assert.equal(nextScreenReaderFocusIndex(-1, 4, 'next'), 0);
  assert.equal(nextScreenReaderFocusIndex(-1, 4, 'previous'), 3);
  assert.equal(nextScreenReaderFocusIndex(1, 4, 'next'), 2);
  assert.equal(nextScreenReaderFocusIndex(1, 4, 'previous'), 0);
  assert.equal(nextScreenReaderFocusIndex(3, 4, 'next'), null);
  assert.equal(nextScreenReaderFocusIndex(0, 4, 'previous'), null);
  assert.equal(nextScreenReaderFocusIndex(0, 0, 'next'), null);
});

test('repeated next swipes traverse the full focus list in order without returning to the top', () => {
  const visited: number[] = [];
  let current = -1;
  while (true) {
    const next = nextScreenReaderFocusIndex(current, 5, 'next');
    if (next === null) break;
    visited.push(next);
    current = next;
  }
  assert.deepEqual(visited, [0, 1, 2, 3, 4]);
});

test('reader keyboard shortcuts navigate headings and items or open safe sections', () => {
  const shortcut = (code: string) => screenReaderKeyboardActionForKey({
    code, altKey: true, shiftKey: true, ctrlKey: false, metaKey: false,
  });
  assert.equal(shortcut('ArrowLeft'), 'previous-heading');
  assert.equal(shortcut('ArrowRight'), 'next-heading');
  assert.equal(shortcut('ArrowUp'), 'previous-item');
  assert.equal(shortcut('ArrowDown'), 'next-item');
  assert.equal(shortcut('KeyH'), 'home');
  assert.equal(shortcut('KeyS'), 'save');
  assert.equal(shortcut('KeyE'), 'employees');
  assert.equal(shortcut('KeyC'), 'cards');
  assert.equal(shortcut('KeyX'), null);
});

test('reader keyboard shortcuts require the documented key combination', () => {
  assert.equal(screenReaderKeyboardActionForKey({
    code: 'ArrowRight', altKey: true, shiftKey: false, ctrlKey: false, metaKey: false,
  }), null);
  assert.equal(screenReaderKeyboardActionForKey({
    code: 'ArrowRight', altKey: true, shiftKey: true, ctrlKey: true, metaKey: false,
  }), null);
});

test('speech rate stays in the supported accessible range', () => {
  assert.equal(normalizeSpeechRate(1.3), 1.3);
  assert.equal(normalizeSpeechRate(0.1), 0.6);
  assert.equal(normalizeSpeechRate(4), 1.8);
  assert.equal(normalizeSpeechRate(Number.NaN), 1);
  assert.equal(normalizeSpeechRate('fast'), 1);
});

test('speech volume is normalized to the browser-supported range', () => {
  assert.equal(normalizeSpeechVolume(0.5), 0.5);
  assert.equal(normalizeSpeechVolume(0), 0.1);
  assert.equal(normalizeSpeechVolume(1.5), 1);
  assert.equal(normalizeSpeechVolume(Number.NaN), 0.8);
});

test('save gesture only selects normal save actions, never destructive or financial confirmation actions', () => {
  for (const label of ['Lưu', 'Lưu ca', 'Ghi nhận', 'Tạo nhân viên', 'Cập nhật']) {
    assert.equal(isSafeSaveLabel(label), true, label);
  }
  for (const label of ['Xóa lịch sử', 'Nạp thẻ', 'Xác nhận', 'Chuyển database']) {
    assert.equal(isSafeSaveLabel(label), false, label);
  }
});
