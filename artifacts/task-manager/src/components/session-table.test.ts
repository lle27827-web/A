import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ServiceSession } from '@workspace/api-client-react';
import { SessionTable } from './session-table';

const session: ServiceSession = {
  id: 1, cardId: 2, memberId: 3, serviceTypeId: 4,
  employeeName: 'TEST_TECHNICIAN', customerName: 'HIDDEN_CUSTOMER', serviceType: 'HIDDEN_SERVICE',
  workDate: '2026-10-09', minutes: 90, customerHourlyRate: 200000,
  customerCharge: 300000, hourlyRate: 100000, earnings: 150000,
  note: 'TEST_NOTE', createdAt: '2026-10-09T03:00:00Z',
};
function render(cardHistory: boolean, row = session) {
  return renderToStaticMarkup(createElement(SessionTable, {
    sessions: [row], caption: 'History', canEdit: true,
    showDate: true, showTime: true, showEmployee: true, cardHistory,
    onEdit: () => {}, onDelete: () => {}, testId: 'card-usages',
  }));
}
test('card history keeps date/time, employee, hours, notes and owner actions only', () => {
  const html = render(true);
  for (const value of ['Ngày / giờ ghi', 'TEST_TECHNICIAN', 'Số giờ', 'TEST_NOTE', 'Ghi 10:00', 'button-edit-session-1', 'button-delete-session-1']) {
    assert.ok(html.includes(value), `Missing ${value}`);
  }
  for (const value of ['HIDDEN_CUSTOMER', 'HIDDEN_SERVICE', 'Tiền dịch vụ', 'Lương', 'Đã tính khi bán thẻ']) {
    assert.ok(!html.includes(value), `Unexpected ${value}`);
  }
  assert.equal((html.match(/<th scope="col">/g) ?? []).length, 5);
});
test('regular employee session tables retain customer and financial information', () => {
  const html = render(false);
  for (const value of ['HIDDEN_CUSTOMER', 'HIDDEN_SERVICE', 'Tiền dịch vụ / lương', 'Lương']) {
    assert.ok(html.includes(value));
  }
});
test('editable employee rows contain exactly one edit/delete pair in the same row', () => {
  const html = renderToStaticMarkup(createElement(SessionTable, {
    sessions: [session], caption: 'Employee shifts', canEdit: true, visibleActions: true,
    onEdit: () => {}, onDelete: () => {}, testId: 'employee-shifts',
  }));
  assert.equal((html.match(/data-testid="row-session-1"/g) ?? []).length, 1);
  assert.equal((html.match(/data-testid="button-edit-session-1"/g) ?? []).length, 1);
  assert.equal((html.match(/data-testid="button-delete-session-1"/g) ?? []).length, 1);
  const row = html.match(/<tr[^>]*data-testid="row-session-1"[\s\S]*?<\/tr>/)?.[0] ?? '';
  assert.ok(row.includes('button-edit-session-1') && row.includes('button-delete-session-1'));
  assert.ok(row.includes('Sửa') && row.includes('Xóa'));
});
test('read-only employee rows never expose edit/delete controls', () => {
  const html = renderToStaticMarkup(createElement(SessionTable, {
    sessions: [session], caption: 'Employee history', canEdit: false, visibleActions: true,
    onEdit: () => {}, onDelete: () => {}, testId: 'employee-history',
  }));
  assert.ok(!html.includes('button-edit-session-') && !html.includes('button-delete-session-'));
  assert.ok(html.includes('TEST_NOTE'));
});
test('deleted technicians remain visible without an invalid edit action', () => {
  const html = render(true, { ...session, memberId: null });
  assert.ok(html.includes('TEST_TECHNICIAN (đã xóa)'));
  assert.ok(!html.includes('button-edit-session-1'));
  assert.ok(html.includes('button-delete-session-1'));
});
