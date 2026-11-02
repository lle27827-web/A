/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardTopUp, ServiceSession, TreatmentCard } from '@workspace/api-client-react';
import {
  CARD_CHECKBOX_COUNT,
  buildPrintDocumentHtml,
  printPreviewRows,
  serviceSessionPrintRows,
  cardTopUpPrintRows,
  cardPurchaseMinutes,
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

const topUp: CardTopUp = {
  id: 2,
  minutes: 90,
  amount: 150_000,
  paymentDate: '2026-11-02',
  source: 'topup',
  note: '',
  createdAt: '2026-11-02T12:00:00.000Z',
};

test('purchase slip contains only the requested customer, card, duration and purchase date', () => {
  const rows = treatmentCardPrintRows(card);
  assert.deepEqual(rows.slice(0, 3), [
    { label: 'Tên khách hàng', value: card.customerName },
    { label: 'Số điện thoại', value: card.phone },
    { label: 'Tên dịch vụ', value: card.serviceType },
  ]);
  assert.deepEqual(rows.slice(3).map((row) => row.label), ['Số giờ mua', 'Ngày bán thẻ']);
  assert.equal(rows[3]?.value, '10 giờ');
  assert.equal(rows[4]?.value, '31/10/2026');
  assert.equal(rows.some((row) => /tiền|còn lại|ghi chú/iu.test(row.label)), false);
});

test('each top-up slip uses the exact top-up hours and date, not the card balance', () => {
  const rows = cardTopUpPrintRows(card, topUp);
  assert.deepEqual(rows.slice(3), [
    { label: 'Số giờ nạp', value: '1 giờ 30 phút' },
    { label: 'Ngày nạp', value: '02/11/2026' },
  ]);
  const cardWithTopUp = { ...card, totalMinutes: 690, topUps: [topUp] };
  assert.equal(cardPurchaseMinutes(cardWithTopUp), 600);
  assert.equal(treatmentCardPrintRows(cardWithTopUp)[3]?.value, '10 giờ');
});

test('card template always prints exactly ten empty usage boxes and the footer in order', () => {
  assert.equal(CARD_CHECKBOX_COUNT, 10);
  const html = buildPrintDocumentHtml('Thẻ khách hàng', treatmentCardPrintRows(card), 'thermal-58', {
    checkboxCount: CARD_CHECKBOX_COUNT,
    facilityPhone: '028 1234 5678',
    cardFooter: true,
  });
  assert.equal([...html.matchAll(/class="check-square"/gu)].length, 10);
  assert.match(html, /Số điện thoại cơ sở: 028 1234 5678/u);
  assert.ok(html.indexOf('Số điện thoại cơ sở:') < html.indexOf('Cảm ơn quý khách đã sử dụng dịch vụ'));
});

test('attendance slip contains employee, service, hours and date without unrelated fields', () => {
  assert.deepEqual(serviceSessionPrintRows(session).map((row) => row.label), [
    'Tên nhân viên',
    'Tên loại hình dịch vụ',
    'Số giờ',
    'Ngày chấm công',
  ]);
  assert.equal(serviceSessionPrintRows(session).some((row) => /khách|tiền|ghi chú/iu.test(row.label)), false);
});

test('settings previews show the same fields as purchase and attendance slips', () => {
  const cardRows = printPreviewRows('card');
  const sessionRows = printPreviewRows('session');
  assert.deepEqual(cardRows.map((row) => row.label), [
    'Tên khách hàng',
    'Số điện thoại',
    'Tên dịch vụ',
    'Số giờ mua',
    'Ngày bán thẻ',
  ]);
  assert.equal(sessionRows.find((row) => row.label === 'Tên nhân viên')?.value, 'Nhân viên mẫu');
  assert.equal(sessionRows.find((row) => row.label === 'Số giờ')?.value, '1 giờ 30 phút');
});

test('print document escapes customer text and applies the selected paper size', () => {
  const html = buildPrintDocumentHtml('Thẻ khách', treatmentCardPrintRows(card), 'a5');
  assert.match(html, /size: A5 portrait/u);
  assert.match(html, /Lan &lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
});
