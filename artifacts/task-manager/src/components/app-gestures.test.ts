/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appTouchGestureForPath,
  isSafeAppSaveLabel,
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

test('back follows route history and falls back from direct detail links', () => {
  const firstBack = previousAppLocation(['/', '/cards', '/cards/12'], '/cards/12');
  assert.deepEqual(firstBack, { target: '/cards', history: ['/', '/cards'] });
  assert.deepEqual(previousAppLocation([], '/employees/7?month=2026-10'), {
    target: '/employees?month=2026-10',
    history: ['/employees?month=2026-10'],
  });
  assert.deepEqual(previousAppLocation(['/'], '/'), { target: null, history: ['/'] });
});
