/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServiceSession, TreatmentCard } from '@workspace/api-client-react';
import {
  buildPrintDocumentHtml,
  hourChecklistLabels,
  printPreviewRows,
  serviceSessionPrintRows,
  treatmentCardPrintRows,
} from './printing.ts';

const card: TreatmentCard = {
  id: 1,
  customerName: 'Lan <script>alert(1)</script>',
  phone: '0900 123 456',
  serviceType: 'Massage',
  totalMinutes: 600,
  usedMinutes: 90,
  remainingMinutes: 510,
  purchaseAmount: 500_000,
  totalPaidAmount: 500_000,
  topUps: [],
  purchaseDate: '2026-10-31',
  note: '',
  createdAt: '2026-10-31T12:00:00.000Z',
};

const session: ServiceSession = {
  id: 7,
  cardId: null,
  memberId: 2,
  employeeName: 'Mai',
  serviceTypeId: 1,
  customerName: 'An',
  serviceType: 'Trị liệu',
  workDate: '2026-11-01',
  minutes: 90,
  customerHourlyRate: 0,
  customerCharge: 0,
  hourlyRate: 0,
  earnings: 0,
  note: '',
  createdAt: '2026-11-01T12:00:00.000Z',
  archived: false,
};

test('card print includes the customer contact, treatment card and configured facility phone', () => {
  const rows = treatmentCardPrintRows(card, '028 1234 5678');
  assert.deepEqual(rows.slice(0, 3), [
    { label: 'Khách hàng', value: card.customerName },
    { label: 'Số điện thoại', value: card.phone },
    { label: 'Thẻ liệu trình', value: card.serviceType },
  ]);
  assert.equal(rows.at(-1)?.value, '028 1234 5678');
  assert.equal(treatmentCardPrintRows(card, '').at(-1)?.value, '____________________');
});

test('card checklist has one tick box per purchased hour and one partial-time box', () => {
  assert.deepEqual(hourChecklistLabels(150), ['1 giờ', '2 giờ', '30 phút']);
  assert.deepEqual(hourChecklistLabels(45), ['45 phút']);
  assert.deepEqual(hourChecklistLabels(0), []);
  const html = buildPrintDocumentHtml('Thẻ', [], 'thermal-58', hourChecklistLabels(150));
  assert.equal([...html.matchAll(/class="checklist-cell"/gu)].length, 3);
});

test('session print includes employee, customer, service, duration and work date', () => {
  assert.deepEqual(serviceSessionPrintRows(session).map((row) => row.label), [
    'Nhân viên',
    'Khách hàng',
    'Loại dịch vụ',
    'Thời lượng làm',
    'Ngày làm',
  ]);
});

test('settings preview uses sample card and attendance content plus the configured facility phone', () => {
  const cardRows = printPreviewRows('card', '028 1111 2222');
  const sessionRows = printPreviewRows('session', '');
  assert.equal(cardRows.find((row) => row.label === 'Điện thoại cơ sở')?.value, '028 1111 2222');
  assert.equal(sessionRows.find((row) => row.label === 'Nhân viên')?.value, 'Nhân viên mẫu');
  assert.equal(sessionRows.find((row) => row.label === 'Thời lượng làm')?.value, '1 giờ 30 phút');
});

test('print document escapes customer text and applies the selected paper size', () => {
  const html = buildPrintDocumentHtml('Thẻ khách', treatmentCardPrintRows(card, ''), 'a5');
  assert.match(html, /size: A5 portrait/u);
  assert.match(html, /Lan &lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
});
