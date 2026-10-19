import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSafeSaveLabel,
  nextScreenReaderFocusIndex,
  normalizeSpeechRate,
  screenReaderActionForSwipes,
  screenReaderFocusNavigationForSwipe,
} from './screen-reader-gestures.ts';

test('single swipes return home or save the active form', () => {
  assert.equal(screenReaderActionForSwipes(['up']), 'home');
  assert.equal(screenReaderActionForSwipes(['down']), 'save');
});

test('opposite two-swipe gestures open the requested sections', () => {
  assert.equal(screenReaderActionForSwipes(['up', 'down']), 'employees');
  assert.equal(screenReaderActionForSwipes(['down', 'up']), 'cards');
});

test('unknown gesture sequences do nothing', () => {
  assert.equal(screenReaderActionForSwipes([]), null);
  assert.equal(screenReaderActionForSwipes(['up', 'up']), null);
  assert.equal(screenReaderActionForSwipes(['down', 'down']), null);
  assert.equal(screenReaderActionForSwipes(['up', 'down', 'up']), null);
});

test('horizontal swipes move focus through page elements without changing vertical shortcuts', () => {
  assert.equal(screenReaderFocusNavigationForSwipe('left'), 'previous');
  assert.equal(screenReaderFocusNavigationForSwipe('right'), 'next');
  assert.equal(screenReaderFocusNavigationForSwipe('up'), null);
  assert.equal(screenReaderFocusNavigationForSwipe('down'), null);
  assert.equal(screenReaderActionForSwipes(['left']), null);
  assert.equal(screenReaderActionForSwipes(['right']), null);
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

test('speech rate stays in the supported accessible range', () => {
  assert.equal(normalizeSpeechRate(1.3), 1.3);
  assert.equal(normalizeSpeechRate(0.1), 0.6);
  assert.equal(normalizeSpeechRate(4), 1.8);
  assert.equal(normalizeSpeechRate(Number.NaN), 1);
  assert.equal(normalizeSpeechRate('fast'), 1);
});

test('save gesture only selects normal save actions, never destructive or financial confirmation actions', () => {
  for (const label of ['Lưu', 'Lưu ca', 'Ghi nhận', 'Tạo nhân viên', 'Cập nhật']) {
    assert.equal(isSafeSaveLabel(label), true, label);
  }
  for (const label of ['Xóa lịch sử', 'Nạp thẻ', 'Xác nhận', 'Chuyển database']) {
    assert.equal(isSafeSaveLabel(label), false, label);
  }
});
