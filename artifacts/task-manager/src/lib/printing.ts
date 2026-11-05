import type { CardTopUp, ServiceSession, TreatmentCard } from '@workspace/api-client-react';

export type PrintPaperSize =
  | 'thermal-58' | 'thermal-80' | 'thermal-110'
  | 'a0' | 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6' | 'a7'
  | 'b4' | 'b5' | 'letter' | 'legal' | 'executive' | 'statement' | 'tabloid'
  | 'custom';

export type PrintPreferences = {
  autoPrintServiceSessions: boolean;
  autoPrintCardSales: boolean;
  autoPrintCardTopUps: boolean;
  paperSize: PrintPaperSize;
  customWidthMm: number;
  customHeightMm: number;
  facilityName: string;
  facilityAddress: string;
  facilityTaxCode: string;
  facilityPhone: string;
};

export type PrintRow = { label: string; value: string };
export type PrintPreviewKind = 'card' | 'sale' | 'topup' | 'session';
export type PrintPageLayout = {
  page: string;
  width: string;
  widthMm: number;
  heightMm: number;
  fontSize: string;
  previewFontPx: number;
  previewWidthPx: number;
  margin: string;
};
export const CARD_CHECKBOX_COUNT = 10;

export const DEFAULT_PRINT_PREFERENCES: PrintPreferences = {
  autoPrintServiceSessions: true,
  autoPrintCardSales: true,
  autoPrintCardTopUps: true,
  paperSize: 'thermal-80',
  customWidthMm: 100,
  customHeightMm: 150,
  facilityName: '',
  facilityAddress: '',
  facilityTaxCode: '',
  facilityPhone: '',
};

type PrintPaperSpec = PrintPageLayout & { value: PrintPaperSize; label: string };

const PAPER_SPECS: readonly PrintPaperSpec[] = [
  { value: 'thermal-58', label: 'Máy in nhiệt 58 mm', page: '58mm 180mm', width: '50mm', widthMm: 58, heightMm: 180, fontSize: '11pt', previewFontPx: 10, previewWidthPx: 150, margin: '3mm' },
  { value: 'thermal-80', label: 'Máy in nhiệt 80 mm', page: '80mm 200mm', width: '72mm', widthMm: 80, heightMm: 200, fontSize: '12pt', previewFontPx: 11, previewWidthPx: 185, margin: '4mm' },
  { value: 'thermal-110', label: 'Máy in nhiệt 110 mm', page: '110mm 220mm', width: '102mm', widthMm: 110, heightMm: 220, fontSize: '13pt', previewFontPx: 12, previewWidthPx: 220, margin: '4mm' },
  { value: 'a0', label: 'A0 · 841 × 1189 mm', page: 'A0 portrait', width: '821mm', widthMm: 841, heightMm: 1189, fontSize: '20pt', previewFontPx: 15, previewWidthPx: 320, margin: '10mm' },
  { value: 'a1', label: 'A1 · 594 × 841 mm', page: 'A1 portrait', width: '574mm', widthMm: 594, heightMm: 841, fontSize: '18pt', previewFontPx: 14, previewWidthPx: 310, margin: '10mm' },
  { value: 'a2', label: 'A2 · 420 × 594 mm', page: 'A2 portrait', width: '400mm', widthMm: 420, heightMm: 594, fontSize: '17pt', previewFontPx: 14, previewWidthPx: 295, margin: '10mm' },
  { value: 'a3', label: 'A3 · 297 × 420 mm', page: 'A3 portrait', width: '277mm', widthMm: 297, heightMm: 420, fontSize: '16pt', previewFontPx: 13, previewWidthPx: 270, margin: '10mm' },
  { value: 'a4', label: 'A4 · 210 × 297 mm', page: 'A4 portrait', width: '190mm', widthMm: 210, heightMm: 297, fontSize: '16pt', previewFontPx: 13, previewWidthPx: 245, margin: '10mm' },
  { value: 'a5', label: 'A5 · 148 × 210 mm', page: 'A5 portrait', width: '132mm', widthMm: 148, heightMm: 210, fontSize: '14pt', previewFontPx: 12, previewWidthPx: 205, margin: '8mm' },
  { value: 'a6', label: 'A6 · 105 × 148 mm', page: 'A6 portrait', width: '96mm', widthMm: 105, heightMm: 148, fontSize: '12pt', previewFontPx: 11, previewWidthPx: 175, margin: '6mm' },
  { value: 'a7', label: 'A7 · 74 × 105 mm', page: 'A7 portrait', width: '66mm', widthMm: 74, heightMm: 105, fontSize: '10pt', previewFontPx: 10, previewWidthPx: 155, margin: '4mm' },
  { value: 'b4', label: 'B4 · 250 × 353 mm', page: '250mm 353mm', width: '234mm', widthMm: 250, heightMm: 353, fontSize: '15pt', previewFontPx: 13, previewWidthPx: 260, margin: '8mm' },
  { value: 'b5', label: 'B5 · 176 × 250 mm', page: '176mm 250mm', width: '160mm', widthMm: 176, heightMm: 250, fontSize: '13pt', previewFontPx: 12, previewWidthPx: 220, margin: '8mm' },
  { value: 'letter', label: 'US Letter · 216 × 279 mm', page: '215.9mm 279.4mm', width: '195.9mm', widthMm: 215.9, heightMm: 279.4, fontSize: '16pt', previewFontPx: 13, previewWidthPx: 248, margin: '10mm' },
  { value: 'legal', label: 'US Legal · 216 × 356 mm', page: '215.9mm 355.6mm', width: '195.9mm', widthMm: 215.9, heightMm: 355.6, fontSize: '16pt', previewFontPx: 13, previewWidthPx: 248, margin: '10mm' },
  { value: 'executive', label: 'Executive · 184 × 267 mm', page: '184.15mm 266.7mm', width: '168.15mm', widthMm: 184.15, heightMm: 266.7, fontSize: '13pt', previewFontPx: 12, previewWidthPx: 225, margin: '8mm' },
  { value: 'statement', label: 'Statement · 140 × 216 mm', page: '139.7mm 215.9mm', width: '123.7mm', widthMm: 139.7, heightMm: 215.9, fontSize: '12pt', previewFontPx: 11, previewWidthPx: 195, margin: '8mm' },
  { value: 'tabloid', label: 'Tabloid · 279 × 432 mm', page: '279.4mm 431.8mm', width: '259.4mm', widthMm: 279.4, heightMm: 431.8, fontSize: '16pt', previewFontPx: 13, previewWidthPx: 280, margin: '10mm' },
  { value: 'custom', label: 'Khổ riêng · nhập kích thước', page: '', width: '', widthMm: 100, heightMm: 150, fontSize: '12pt', previewFontPx: 11, previewWidthPx: 185, margin: '4mm' },
];

export const PRINT_PAPER_OPTIONS = PAPER_SPECS.map(({ value, label }) => ({ value, label }));

const STORAGE_PREFIX = 'so-cong:print-settings:v2:';
const LEGACY_STORAGE_PREFIX = 'so-cong:print-settings:';
const CUSTOM_DIMENSION_MIN_MM = 20;
const CUSTOM_DIMENSION_MAX_MM = 1200;

export function normalizeCustomPaperDimension(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(CUSTOM_DIMENSION_MAX_MM, Math.max(CUSTOM_DIMENSION_MIN_MM, parsed)));
}

export function getPrintPageLayout(
  paperSize: PrintPaperSize,
  customWidthMm = DEFAULT_PRINT_PREFERENCES.customWidthMm,
  customHeightMm = DEFAULT_PRINT_PREFERENCES.customHeightMm,
): PrintPageLayout {
  const spec = PAPER_SPECS.find((option) => option.value === paperSize) ?? PAPER_SPECS[1]!;
  if (paperSize !== 'custom') return spec;

  const widthMm = normalizeCustomPaperDimension(customWidthMm, DEFAULT_PRINT_PREFERENCES.customWidthMm);
  const heightMm = normalizeCustomPaperDimension(customHeightMm, DEFAULT_PRINT_PREFERENCES.customHeightMm);
  return {
    page: `${widthMm}mm ${heightMm}mm`,
    width: `${Math.max(10, widthMm - 8)}mm`,
    widthMm,
    heightMm,
    fontSize: '12pt',
    previewFontPx: 11,
    previewWidthPx: Math.round(Math.max(140, Math.min(320, 120 + widthMm * 0.65))),
    margin: '4mm',
  };
}

function formatPrintMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes} phút`;
  return remainingMinutes ? `${hours} giờ ${remainingMinutes} phút` : `${hours} giờ`;
}

function storageKey(userId?: string | null, prefix = STORAGE_PREFIX): string {
  return `${prefix}${userId || 'device'}`;
}

export function readPrintPreferences(userId?: string | null): PrintPreferences {
  try {
    const currentKey = storageKey(userId);
    const legacyKey = storageKey(userId, LEGACY_STORAGE_PREFIX);
    const currentRaw = window.localStorage.getItem(currentKey);
    const legacyRaw = currentRaw === null ? window.localStorage.getItem(legacyKey) : null;
    const isLegacy = currentRaw === null && legacyRaw !== null;
    const raw = currentRaw ?? legacyRaw;
    if (!raw) return { ...DEFAULT_PRINT_PREFERENCES };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PRINT_PREFERENCES };
    const stored = parsed as Record<string, unknown>;
    const paperSize = PRINT_PAPER_OPTIONS.some((option) => option.value === stored.paperSize)
      ? stored.paperSize as PrintPaperSize
      : DEFAULT_PRINT_PREFERENCES.paperSize;
    const preferences: PrintPreferences = {
      autoPrintServiceSessions: isLegacy || stored.autoPrintServiceSessions === undefined
        ? true : stored.autoPrintServiceSessions === true,
      autoPrintCardSales: isLegacy || stored.autoPrintCardSales === undefined
        ? true : stored.autoPrintCardSales === true,
      autoPrintCardTopUps: isLegacy || stored.autoPrintCardTopUps === undefined
        ? true : stored.autoPrintCardTopUps === true,
      paperSize,
      customWidthMm: normalizeCustomPaperDimension(stored.customWidthMm, DEFAULT_PRINT_PREFERENCES.customWidthMm),
      customHeightMm: normalizeCustomPaperDimension(stored.customHeightMm, DEFAULT_PRINT_PREFERENCES.customHeightMm),
      facilityName: typeof stored.facilityName === 'string' ? stored.facilityName.slice(0, 120) : '',
      facilityAddress: typeof stored.facilityAddress === 'string' ? stored.facilityAddress.slice(0, 240) : '',
      facilityTaxCode: typeof stored.facilityTaxCode === 'string' ? stored.facilityTaxCode.slice(0, 40) : '',
      facilityPhone: typeof stored.facilityPhone === 'string' ? stored.facilityPhone.slice(0, 40) : '',
    };
    if (isLegacy) {
      window.localStorage.setItem(currentKey, JSON.stringify(preferences));
      window.localStorage.removeItem(legacyKey);
    }
    return preferences;
  } catch {
    return { ...DEFAULT_PRINT_PREFERENCES };
  }
}

export function writePrintPreferences(userId: string | null | undefined, preferences: PrintPreferences): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(preferences));
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
}

export function escapePrintText(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function displayDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(parsed);
}

function displayDateTime(dateTime: string): string {
  const parsed = new Date(dateTime);
  return Number.isNaN(parsed.getTime())
    ? displayDate(dateTime)
    : new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(parsed);
}

const printCurrency = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
function formatPrintMoney(amount: number): string {
  return `${printCurrency.format(Math.round(amount))} ₫`;
}

function formatPrintPaymentMethod(method: string | null | undefined): string {
  return method === 'cash' ? 'Tiền mặt' : method === 'transfer' ? 'Chuyển khoản' : 'Chưa ghi nhận';
}

function formatReceiptCode(prefix: string, id: number): string {
  return `${prefix}-${String(id).padStart(6, '0')}`;
}

function cardTransactionRows(
  card: TreatmentCard,
  minutes: number,
  date: string,
  durationLabel: string,
  dateLabel: string,
): PrintRow[] {
  return [
    { label: 'Tên khách hàng', value: card.customerName },
    { label: 'Số điện thoại', value: card.phone },
    { label: 'Tên dịch vụ', value: card.serviceType },
    { label: durationLabel, value: formatPrintMinutes(minutes) },
    { label: dateLabel, value: displayDate(date) },
  ];
}

export function cardPurchaseMinutes(card: TreatmentCard): number {
  const toppedUp = card.topUps.reduce((total, payment) => total + Math.max(0, payment.minutes), 0);
  return Math.max(0, card.totalMinutes - toppedUp);
}

export function treatmentCardPrintRows(card: TreatmentCard): PrintRow[] {
  return cardTransactionRows(card, cardPurchaseMinutes(card), card.purchaseDate, 'Số giờ mua', 'Ngày bán thẻ');
}

export type CardSalePrintDetails = {
  amount?: number;
  paymentMethod?: string | null;
  sellerName?: string | null;
  receiptCode?: string;
  createdAt?: string;
};

export function cardSalePrintRows(
  card: TreatmentCard,
  minutes: number,
  purchaseDate: string,
  details: CardSalePrintDetails = {},
): PrintRow[] {
  return [
    { label: 'Mã giao dịch', value: details.receiptCode || formatReceiptCode('THE', card.id) },
    ...cardTransactionRows(card, minutes, purchaseDate, 'Số giờ mua', 'Ngày bán thẻ').slice(0, 4),
    { label: 'Số tiền thanh toán', value: formatPrintMoney(details.amount ?? card.purchaseAmount) },
    { label: 'Phương thức thanh toán', value: formatPrintPaymentMethod(details.paymentMethod ?? card.purchasePaymentMethod) },
    { label: 'Người bán thẻ', value: details.sellerName?.trim() || card.sellerName?.trim() || 'Chưa ghi nhận' },
    { label: 'Ngày bán thẻ', value: displayDate(purchaseDate) },
    { label: 'Thời điểm lập phiếu', value: displayDateTime(details.createdAt || card.createdAt) },
  ];
}

export function cardTopUpPrintRows(card: TreatmentCard, payment: CardTopUp): PrintRow[] {
  return [
    { label: 'Mã giao dịch', value: formatReceiptCode('NT', payment.id) },
    { label: 'Tên khách hàng', value: card.customerName },
    { label: 'Số điện thoại', value: card.phone },
    { label: 'Tên dịch vụ', value: card.serviceType },
    { label: 'Số giờ nạp', value: formatPrintMinutes(payment.minutes) },
    { label: 'Số tiền nạp', value: formatPrintMoney(payment.amount) },
    { label: 'Phương thức thanh toán', value: formatPrintPaymentMethod(payment.paymentMethod) },
    { label: 'Người nạp thẻ', value: payment.sellerName?.trim() || 'Chưa ghi nhận' },
    { label: 'Ngày nạp', value: displayDate(payment.paymentDate) },
    { label: 'Thời điểm lập phiếu', value: displayDateTime(payment.createdAt) },
  ];
}

export function serviceSessionPrintRows(session: ServiceSession): PrintRow[] {
  return [
    { label: 'Mã ca', value: formatReceiptCode('CC', session.id) },
    { label: 'Tên nhân viên', value: session.employeeName },
    { label: 'Tên khách hàng', value: session.customerName || 'Khách lẻ' },
    { label: 'Tên loại hình dịch vụ', value: session.serviceType },
    { label: 'Số giờ', value: formatPrintMinutes(session.minutes) },
    { label: 'Ngày chấm công', value: displayDate(session.workDate) },
    { label: 'Phương thức thanh toán', value: session.cardId !== null ? 'Thẻ khách hàng' : formatPrintPaymentMethod(session.paymentMethod) },
    {
      label: 'Thanh toán tại ca',
      value: session.cardId !== null ? 'Đã thanh toán trước bằng thẻ' : formatPrintMoney(session.customerCharge),
    },
    { label: 'Tiền công nhân viên', value: formatPrintMoney(session.earnings) },
  ];
}

function sampleTreatmentCard(): TreatmentCard {
  return {
    id: 0,
    customerName: 'Khách mẫu',
    phone: '0900 000 000',
    serviceType: 'Massage thư giãn',
    totalMinutes: 300,
    usedMinutes: 60,
    remainingMinutes: 240,
    purchaseAmount: 500_000,
    purchasePaymentMethod: 'cash',
    sellerName: 'Nhân viên bán thẻ',
    totalPaidAmount: 500_000,
    topUps: [],
    purchaseDate: '2026-11-02',
    note: '',
    createdAt: '2026-11-02T00:00:00.000Z',
  };
}

export function printPreviewRows(type: PrintPreviewKind): PrintRow[] {
  const sampleCard = sampleTreatmentCard();
  if (type === 'card') return treatmentCardPrintRows(sampleCard);
  if (type === 'sale') return cardSalePrintRows(sampleCard, cardPurchaseMinutes(sampleCard), sampleCard.purchaseDate);
  if (type === 'topup') {
    const sampleTopUp: CardTopUp = {
      id: 1,
      minutes: 120,
      amount: 150_000,
      paymentDate: '2026-11-02',
      paymentMethod: 'transfer',
      sellerName: 'Nhân viên nạp thẻ',
      source: 'topup',
      note: '',
      createdAt: '2026-11-02T00:00:00.000Z',
    };
    return cardTopUpPrintRows(sampleCard, sampleTopUp);
  }
  const sampleSession: ServiceSession = {
    id: 0,
    cardId: null,
    memberId: 0,
    employeeName: 'Nhân viên mẫu',
    serviceTypeId: 0,
    customerName: 'Khách mẫu',
    serviceType: 'Trị liệu',
    workDate: '2026-11-02',
    minutes: 90,
      customerHourlyRate: 300_000,
      customerCharge: 450_000,
      paymentMethod: 'cash',
      hourlyRate: 100_000,
      earnings: 150_000,
    note: '',
    createdAt: '2026-11-02T00:00:00.000Z',
    archived: false,
  };
  return serviceSessionPrintRows(sampleSession);
}

export function buildPrintDocumentHtml(
  title: string,
  rows: PrintRow[],
  paperSize: PrintPaperSize,
  options: {
    checkboxCount?: number;
    facilityName?: string;
    facilityAddress?: string;
    facilityTaxCode?: string;
    facilityPhone?: string;
    cardFooter?: boolean;
    footerText?: string;
    customWidthMm?: number;
    customHeightMm?: number;
  } = {},
): string {
  const layout = getPrintPageLayout(paperSize, options.customWidthMm, options.customHeightMm);
  const renderedRows = rows.map(({ label, value }) =>
    `<div class="row"><span class="label">${escapePrintText(label)}</span><strong>${escapePrintText(value)}</strong></div>`,
  ).join('');
  const checkboxCount = options.checkboxCount === CARD_CHECKBOX_COUNT ? CARD_CHECKBOX_COUNT : 0;
  const renderedChecklist = checkboxCount
    ? `<section class="checklist" aria-label="Đánh dấu số giờ đã sử dụng">
        <div class="checklist-grid">${Array.from({ length: checkboxCount }, () =>
          '<span class="check-square" aria-hidden="true"></span>',
        ).join('')}</div>
      </section>`
    : '';
  const renderedCardFooter = options.cardFooter
    ? `<p class="facility-phone">Số điện thoại cơ sở: ${escapePrintText(options.facilityPhone?.trim() || '________________')}</p>
       <p class="footer">${escapePrintText(options.footerText || 'Cảm ơn quý khách đã sử dụng dịch vụ')}</p>`
    : options.footerText?.trim()
      ? `<p class="footer">${escapePrintText(options.footerText.trim())}</p>`
      : '';
  const safeTitle = escapePrintText(title);
  const facilityDetails = [
    options.facilityName?.trim(),
    options.facilityAddress?.trim(),
    options.facilityTaxCode?.trim() ? `Mã số thuế: ${options.facilityTaxCode.trim()}` : '',
  ].filter(Boolean);
  const renderedFacilityDetails = facilityDetails.length
    ? `<div class="facility-details">${facilityDetails.map((line) => `<p>${escapePrintText(line!)}</p>`).join('')}</div>`
    : '';
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    @page { size: ${layout.page}; margin: ${layout.margin}; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #21190f; background: #fff; font: ${layout.fontSize}/1.45 Arial, sans-serif; }
    .ticket { width: ${layout.width}; max-width: 100%; margin: 0 auto; padding: 5mm 2mm; }
    header { text-align: center; border-bottom: 1px dashed #79552a; padding-bottom: 4mm; margin-bottom: 4mm; }
    h1 { margin: 0; font-size: 1.05em; }
    .row { display: grid; gap: 1mm; padding: 2.5mm 0; border-bottom: 1px solid #e5ded2; overflow-wrap: anywhere; }
    .label { color: #675b4b; font-size: .82em; }
    .row strong { font-size: 1em; }
    .facility-details { margin-top: 2mm; font-size: .76em; line-height: 1.3; overflow-wrap: anywhere; }
    .facility-details p { margin: 1mm 0; }
    .checklist { margin-top: 4mm; padding-top: 3mm; }
    .checklist-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2mm; }
    .check-square { display: block; width: 7mm; height: 7mm; border: .35mm solid #21190f; break-inside: avoid; }
    .facility-phone { margin: 4mm 0 0; color: #675b4b; text-align: center; font-size: .72em; overflow-wrap: anywhere; }
    .footer { margin-top: 5mm; text-align: center; color: #675b4b; font-size: .8em; }
    .print-actions { margin-top: 6mm; text-align: center; }
    .print-actions button { padding: 2mm 5mm; font: inherit; }
    @media print { .print-actions { display: none; } }
  </style>
</head>
<body>
  <main class="ticket paper-${paperSize}">
    <header>${renderedFacilityDetails}<h1>${safeTitle}</h1></header>
    ${renderedRows}
    ${renderedChecklist}
    ${renderedCardFooter}
    <div class="print-actions"><button type="button" onclick="window.print()">In phiếu</button></div>
  </main>
</body>
</html>`;
}

export function reservePrintWindow(): Window | null {
  try {
    const printWindow = window.open('', '_blank', 'popup,width=520,height=760');
    if (!printWindow) return null;
    printWindow.opener = null;
    printWindow.document.open();
    printWindow.document.write('<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Đang chuẩn bị phiếu in</title></head><body>Đang chuẩn bị phiếu in…</body></html>');
    printWindow.document.close();
    return printWindow;
  } catch {
    return null;
  }
}

export function printRowsInWindow(
  printWindow: Window | null,
  title: string,
  rows: PrintRow[],
  paperSize: PrintPaperSize,
  options: {
    checkboxCount?: number;
    facilityName?: string;
    facilityAddress?: string;
    facilityTaxCode?: string;
    facilityPhone?: string;
    cardFooter?: boolean;
    footerText?: string;
    customWidthMm?: number;
    customHeightMm?: number;
  } = {},
): boolean {
  if (!printWindow || printWindow.closed) return false;
  try {
    return printHtmlInWindow(
      printWindow,
      buildPrintDocumentHtml(title, rows, paperSize, options),
    );
  } catch {
    if (!printWindow.closed) printWindow.close();
    return false;
  }
}

export function printHtmlInWindow(
  printWindow: Window | null,
  html: string,
): boolean {
  if (!printWindow || printWindow.closed) return false;
  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.addEventListener('afterprint', () => {
      if (!printWindow.closed) printWindow.close();
    }, { once: true });
    // Keep print() in the original user gesture. Deferring it to a timer can
    // make browsers block the print dialog as an unexpected popup.
    printWindow.focus();
    printWindow.print();
    return true;
  } catch {
    if (!printWindow.closed) printWindow.close();
    return false;
  }
}

function printCardTransaction(
  printWindow: Window | null,
  title: string,
  rows: PrintRow[],
  preferences: PrintPreferences,
  includeFacilityDetails = false,
): boolean {
  return printRowsInWindow(
    printWindow,
    title,
    rows,
    preferences.paperSize,
    {
      checkboxCount: CARD_CHECKBOX_COUNT,
      facilityPhone: preferences.facilityPhone,
      ...(includeFacilityDetails ? {
        facilityName: preferences.facilityName,
        facilityAddress: preferences.facilityAddress,
        facilityTaxCode: preferences.facilityTaxCode,
      } : {}),
      cardFooter: true,
      customWidthMm: preferences.customWidthMm,
      customHeightMm: preferences.customHeightMm,
    },
  );
}

export function printTreatmentCard(printWindow: Window | null, card: TreatmentCard, preferences: PrintPreferences): boolean {
  return printCardTransaction(printWindow, 'Thẻ khách hàng', treatmentCardPrintRows(card), preferences);
}

export function printCardSale(
  printWindow: Window | null,
  card: TreatmentCard,
  minutes: number,
  purchaseDate: string,
  preferences: PrintPreferences,
  details: CardSalePrintDetails = {},
): boolean {
  return printCardTransaction(
    printWindow,
    'Phiếu bán thẻ',
    cardSalePrintRows(card, minutes, purchaseDate, details),
    preferences,
    true,
  );
}

export function printCardTopUp(
  printWindow: Window | null,
  card: TreatmentCard,
  payment: CardTopUp,
  preferences: PrintPreferences,
): boolean {
  return printCardTransaction(printWindow, 'Phiếu nạp thẻ', cardTopUpPrintRows(card, payment), preferences, true);
}

export function printServiceSession(printWindow: Window | null, session: ServiceSession, preferences: PrintPreferences): boolean {
  return printRowsInWindow(
    printWindow,
    'Phiếu chấm công',
    serviceSessionPrintRows(session),
    preferences.paperSize,
    {
      facilityName: preferences.facilityName,
      facilityAddress: preferences.facilityAddress,
      facilityTaxCode: preferences.facilityTaxCode,
      facilityPhone: preferences.facilityPhone,
      cardFooter: true,
      customWidthMm: preferences.customWidthMm,
      customHeightMm: preferences.customHeightMm,
    },
  );
}
