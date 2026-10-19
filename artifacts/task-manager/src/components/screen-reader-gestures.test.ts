import assert from 'node:assert/strict';
import test from 'node:test';
import { isSafeSaveLabel, screenReaderActionForSwipes } from './screen-reader-gestures.ts';

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

test('save gesture only selects normal save actions, never destructive or financial confirmation actions', () => {
  for (const label of ['Lưu', 'Lưu ca', 'Ghi nhận', 'Tạo nhân viên', 'Cập nhật']) {
    assert.equal(isSafeSaveLabel(label), true, label);
  }
  for (const label of ['Xóa lịch sử', 'Nạp thẻ', 'Xác nhận', 'Chuyển database']) {
    assert.equal(isSafeSaveLabel(label), false, label);
  }
});
