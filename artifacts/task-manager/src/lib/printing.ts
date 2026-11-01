import type { CardTopUp, ServiceSession, TreatmentCard } from '@workspace/api-client-react';

export type PrintPaperSize = 'thermal-58' | 'thermal-80' | 'a6' | 'a5' | 'a4';
export type PrintPreferences = {
  autoPrintServiceSessions: boolean;
  paperSize: PrintPaperSize;
  facilityPhone: string;
};
export type PrintRow = { label: string; value: string };
export const CARD_CHECKBOX_COUNT = 10;

export const DEFAULT_PRINT_PREFERENCES: PrintPreferences = {
  autoPrintServiceSessions: false,
  paperSize: 'thermal-80',
  facilityPhone: '',
};

export const PRINT_PAPER_OPTIONS: { value: PrintPaperSize; label: string }[] = [
  { value: 'thermal-58', label: 'Nhiệt 58 mm · nhỏ' },
  { value: 'thermal-80', label: 'Nhiệt 80 mm' },
  { value: 'a6', label: 'A6' },
  { value: 'a5', label: 'A5' },
  { value: 'a4', label: 'A4 · lớn' },
];

const STORAGE_PREFIX = 'so-cong:print-settings:';

function formatPrintMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes} phút`;
  return remainingMinutes ? `${hours} giờ ${remainingMinutes} phút` : `${hours} giờ`;
}

function storageKey(userId?: string | null): string {
  return `${STORAGE_PREFIX}${userId || 'device'}`;
}

export function readPrintPreferences(userId?: string | null): PrintPreferences {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULT_PRINT_PREFERENCES };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PRINT_PREFERENCES };
    const stored = parsed as Record<string, unknown>;
    const paperSize = PRINT_PAPER_OPTIONS.some((option) => option.value === stored.paperSize)
      ? stored.paperSize as PrintPaperSize
      : DEFAULT_PRINT_PREFERENCES.paperSize;
    return {
      autoPrintServiceSessions: stored.autoPrintServiceSessions === true,
      paperSize,
      facilityPhone: typeof stored.facilityPhone === 'string' ? stored.facilityPhone.slice(0, 40) : '',
    };
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

const PAGE_LAYOUT: Record<PrintPaperSize, { page: string; width: string; fontSize: string; margin: string }> = {
  'thermal-58': { page: '58mm auto', width: '50mm', fontSize: '11pt', margin: '3mm' },
  'thermal-80': { page: '80mm auto', width: '72mm', fontSize: '12pt', margin: '4mm' },
  a6: { page: 'A6 portrait', width: '96mm', fontSize: '12pt', margin: '6mm' },
  a5: { page: 'A5 portrait', width: '132mm', fontSize: '14pt', margin: '8mm' },
  a4: { page: 'A4 portrait', width: '190mm', fontSize: '16pt', margin: '10mm' },
};

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

export function cardTopUpPrintRows(card: TreatmentCard, payment: CardTopUp): PrintRow[] {
  return cardTransactionRows(card, payment.minutes, payment.paymentDate, 'Số giờ nạp', 'Ngày nạp');
}

export function serviceSessionPrintRows(session: ServiceSession): PrintRow[] {
  return [
    { label: 'Tên nhân viên', value: session.employeeName },
    { label: 'Tên loại hình dịch vụ', value: session.serviceType },
    { label: 'Số giờ', value: formatPrintMinutes(session.minutes) },
    { label: 'Ngày chấm công', value: displayDate(session.workDate) },
  ];
}

export function printPreviewRows(type: 'card' | 'session', facilityPhone: string): PrintRow[] {
  if (type === 'card') {
    const sampleCard: TreatmentCard = {
      id: 0,
      customerName: 'Khách mẫu',
      phone: '0900 000 000',
      serviceType: 'Massage thư giãn',
      totalMinutes: 300,
      usedMinutes: 60,
      remainingMinutes: 240,
      purchaseAmount: 0,
      totalPaidAmount: 0,
      topUps: [],
      purchaseDate: '2026-11-02',
      note: '',
      createdAt: '2026-11-02T00:00:00.000Z',
    };
    return treatmentCardPrintRows(sampleCard);
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
    customerHourlyRate: 0,
    customerCharge: 0,
    hourlyRate: 0,
    earnings: 0,
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
  options: { checkboxCount?: number; facilityPhone?: string; cardFooter?: boolean; footerText?: string } = {},
): string {
  const layout = PAGE_LAYOUT[paperSize];
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
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle} · SỔ CÔNG</title>
  <style>
    @page { size: ${layout.page}; margin: ${layout.margin}; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #21190f; background: #fff; font: ${layout.fontSize}/1.45 Arial, sans-serif; }
    .ticket { width: ${layout.width}; max-width: 100%; margin: 0 auto; padding: 5mm 2mm; }
    header { text-align: center; border-bottom: 1px dashed #79552a; padding-bottom: 4mm; margin-bottom: 4mm; }
    .brand { margin: 0 0 2mm; color: #8b3025; font-size: 1.25em; font-weight: 800; letter-spacing: .08em; }
    h1 { margin: 0; font-size: 1.05em; }
    .row { display: grid; gap: 1mm; padding: 2.5mm 0; border-bottom: 1px solid #e5ded2; overflow-wrap: anywhere; }
    .label { color: #675b4b; font-size: .82em; }
    .row strong { font-size: 1em; }
    .checklist { margin-top: 4mm; border-top: 1px dashed #79552a; padding-top: 3mm; }
    .checklist { margin-top: 4mm; padding-top: 3mm; }
    .checklist-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2mm; }
    .check-square { display: block; width: 7mm; height: 7mm; border: .35mm solid #21190f; break-inside: avoid; }
    .paper-thermal-58 .checklist-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .paper-a5 .checklist-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .paper-a4 .checklist-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .facility-phone { margin: 4mm 0 0; color: #675b4b; text-align: center; font-size: .72em; overflow-wrap: anywhere; }
    .footer { margin-top: 5mm; text-align: center; color: #675b4b; font-size: .8em; }
    .print-actions { margin-top: 6mm; text-align: center; }
    .print-actions button { padding: 2mm 5mm; font: inherit; }
    @media print { .print-actions { display: none; } }
  </style>
</head>
<body>
  <main class="ticket paper-${paperSize}">
    <header><p class="brand">SỔ CÔNG</p><h1>${safeTitle}</h1></header>
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
  options: { checkboxCount?: number; facilityPhone?: string; cardFooter?: boolean; footerText?: string } = {},
): boolean {
  if (!printWindow || printWindow.closed) return false;
  try {
    printWindow.document.open();
    printWindow.document.write(buildPrintDocumentHtml(title, rows, paperSize, options));
    printWindow.document.close();
    printWindow.addEventListener('afterprint', () => {
      if (!printWindow.closed) printWindow.close();
    }, { once: true });
    window.setTimeout(() => {
      if (!printWindow.closed) {
        printWindow.focus();
        printWindow.print();
      }
    }, 300);
    return true;
  } catch {
    if (!printWindow.closed) printWindow.close();
    return false;
  }
}

export function printTreatmentCard(printWindow: Window | null, card: TreatmentCard, preferences: PrintPreferences): boolean {
  return printRowsInWindow(
    printWindow,
    'Thẻ khách hàng',
    treatmentCardPrintRows(card),
    preferences.paperSize,
    { checkboxCount: CARD_CHECKBOX_COUNT, facilityPhone: preferences.facilityPhone, cardFooter: true },
  );
}

export function printCardTopUp(
  printWindow: Window | null,
  card: TreatmentCard,
  payment: CardTopUp,
  preferences: PrintPreferences,
): boolean {
  return printRowsInWindow(
    printWindow,
    'Thẻ khách hàng',
    cardTopUpPrintRows(card, payment),
    preferences.paperSize,
    { checkboxCount: CARD_CHECKBOX_COUNT, facilityPhone: preferences.facilityPhone, cardFooter: true },
  );
}

export function printServiceSession(printWindow: Window | null, session: ServiceSession, preferences: PrintPreferences): boolean {
  return printRowsInWindow(
    printWindow,
    'Phiếu chấm công nhân viên',
    serviceSessionPrintRows(session),
    preferences.paperSize,
    {},
  );
}
