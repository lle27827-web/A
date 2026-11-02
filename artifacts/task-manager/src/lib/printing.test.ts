/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardTopUp, ServiceSession, TreatmentCard } from '@workspace/api-client-react';
import {
  CARD_CHECKBOX_COUNT,
  buildPrintDocumentHtml,
  cardSalePrintRows,
  getPrintPageLayout,
  PRINT_PAPER_OPTIONS,
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

test('automatic sale receipt uses only the newly purchased hours and date, including merged sales', () => {
  assert.deepEqual(cardSalePrintRows(card, 120, '2026-11-02').slice(3), [
    { label: 'Số giờ mua', value: '2 giờ' },
    { label: 'Ngày bán thẻ', value: '02/11/2026' },
  ]);
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
  const cardRows = printPreviewRows('sale');
  const topUpRows = printPreviewRows('topup');
  const sessionRows = printPreviewRows('session');
  assert.deepEqual(cardRows.map((row) => row.label), [
    'Tên khách hàng',
    'Số điện thoại',
    'Tên dịch vụ',
    'Số giờ mua',
    'Ngày bán thẻ',
  ]);
  assert.deepEqual(topUpRows.slice(3).map((row) => row.label), ['Số giờ nạp', 'Ngày nạp']);
  assert.equal(sessionRows.find((row) => row.label === 'Tên nhân viên')?.value, 'Nhân viên mẫu');
  assert.equal(sessionRows.find((row) => row.label === 'Số giờ')?.value, '1 giờ 30 phút');
});

test('paper list covers common printer formats and a custom size', () => {
  const available = new Set(PRINT_PAPER_OPTIONS.map((option) => option.value));
  for (const size of ['thermal-58', 'thermal-80', 'thermal-110', 'a0', 'a4', 'a7', 'b4', 'b5', 'letter', 'legal', 'executive', 'statement', 'tabloid', 'custom'] as const) {
    assert.equal(available.has(size), true, `missing ${size}`);
  }
  assert.equal(getPrintPageLayout('thermal-58').page, '58mm 180mm');
  assert.equal(getPrintPageLayout('thermal-80').page, '80mm 200mm');
  assert.equal(getPrintPageLayout('thermal-110').page, '110mm 220mm');
  const a4 = getPrintPageLayout('a4');
  const a3 = getPrintPageLayout('a3');
  assert.equal(a4.page, 'A4 portrait');
  assert.ok(a3.widthMm > a4.widthMm);
  const custom = getPrintPageLayout('custom', 120, 180);
  assert.equal(custom.page, '120mm 180mm');
  assert.equal(custom.widthMm, 120);
  assert.equal(getPrintPageLayout('custom', 1, 2000).page, '20mm 1200mm');
});

test('print document escapes customer text, applies paper size and omits the brand line', () => {
  const html = buildPrintDocumentHtml('Thẻ khách', treatmentCardPrintRows(card), 'a5');
  assert.match(html, /size: A5 portrait/u);
  assert.match(html, /Lan &lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /SỔ CÔNG/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
});

test('custom print document applies selected custom dimensions', () => {
  const html = buildPrintDocumentHtml('Phiếu chấm công', serviceSessionPrintRows(session), 'custom', {
    customWidthMm: 100,
    customHeightMm: 160,
  });
  assert.match(html, /@page \{ size: 100mm 160mm; margin: 4mm; \}/u);
});
