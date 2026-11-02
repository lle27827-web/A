import { useState } from 'react';
import { Printer } from 'lucide-react';
import {
  CARD_CHECKBOX_COUNT,
  getPrintPageLayout,
  PRINT_PAPER_OPTIONS,
  printRowsInWindow,
  printPreviewRows,
  reservePrintWindow,
  type PrintPaperSize,
} from '@/lib/printing';

export function PrintPreview({ paperSize, customWidthMm, customHeightMm, facilityPhone }: {
  paperSize: PrintPaperSize;
  customWidthMm: number;
  customHeightMm: number;
  facilityPhone: string;
}) {
  const [printFeedback, setPrintFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [cardPreviewKind, setCardPreviewKind] = useState<'sale' | 'topup'>('sale');
  const paperLabel = PRINT_PAPER_OPTIONS.find((option) => option.value === paperSize)?.label ?? 'Khổ giấy';
  const layout = getPrintPageLayout(paperSize, customWidthMm, customHeightMm);
  const previews = [
    { kind: 'card' as const, title: 'Thẻ khách hàng', caption: 'Mẫu thẻ khách hàng' },
    { kind: 'session' as const, title: 'Phiếu chấm công', caption: 'Phiếu chấm công' },
  ];

  function printSample(kind: 'sale' | 'topup' | 'session', title: string, caption: string) {
    setPrintFeedback(null);
    const printWindow = reservePrintWindow();
    if (!printWindow) {
      setPrintFeedback({ kind: 'error', message: 'Trình duyệt đang chặn cửa sổ in. Hãy cho phép cửa sổ bật lên rồi thử lại.' });
      return;
    }
    const isCard = kind !== 'session';
    const printed = printRowsInWindow(
      printWindow,
      title,
      printPreviewRows(kind),
      paperSize,
      {
        checkboxCount: isCard ? CARD_CHECKBOX_COUNT : 0,
        facilityPhone,
        cardFooter: isCard,
        customWidthMm,
        customHeightMm,
      },
    );
    if (!printed) {
      if (!printWindow.closed) printWindow.close();
      setPrintFeedback({ kind: 'error', message: 'Không thể mở phiếu in thử.' });
      return;
    }
    setPrintFeedback({ kind: 'success', message: `Đã mở phiếu ${caption}. Chọn máy in trong hộp thoại để in.` });
  }

  return (
    <section className="print-preview-area" aria-labelledby="print-preview-title">
      <div className="print-preview-heading">
        <h4 id="print-preview-title">Xem trước phiếu in</h4>
        <span>{paperLabel}</span>
      </div>
      <div className="print-preview-grid">
        {previews.map((preview) => {
          const sampleKind = preview.kind === 'card' ? cardPreviewKind : 'session';
          const sampleCaption = preview.kind === 'card'
            ? (cardPreviewKind === 'sale' ? 'Mua thẻ' : 'Nạp thẻ')
            : 'Phiếu chấm công';
          const isCard = preview.kind === 'card';
          const figureCaption = isCard ? `Mẫu thẻ khách hàng · ${sampleCaption}` : sampleCaption;
          return (
            <figure className="print-preview-figure" key={preview.kind}>
              {isCard && (
                <div className="print-preview-modes" role="group" aria-label="Loại giao dịch trên mẫu thẻ khách hàng">
                  <button
                    type="button"
                    className={`btn ghost small print-preview-mode${cardPreviewKind === 'sale' ? ' is-active' : ''}`}
                    aria-pressed={cardPreviewKind === 'sale'}
                    onClick={() => setCardPreviewKind('sale')}
                  >
                    Mua thẻ
                  </button>
                  <button
                    type="button"
                    className={`btn ghost small print-preview-mode${cardPreviewKind === 'topup' ? ' is-active' : ''}`}
                    aria-pressed={cardPreviewKind === 'topup'}
                    onClick={() => setCardPreviewKind('topup')}
                  >
                    Nạp thẻ
                  </button>
                </div>
              )}
            <article
              className={`print-preview-sheet print-preview-sheet--${paperSize}`}
              style={{
                width: `${layout.previewWidthPx}px`,
                aspectRatio: `${layout.widthMm} / ${layout.heightMm}`,
                fontSize: `${layout.previewFontPx}px`,
              }}
              aria-label={`Xem trước ${figureCaption}, ${paperLabel}${paperSize === 'custom' ? `, ${layout.widthMm} nhân ${layout.heightMm} milimét` : ''}`}
              data-testid={`print-preview-${sampleKind}`}
            >
              <header className="print-preview-sheet-header">
                <span>{preview.title}</span>
              </header>
              <div className="print-preview-rows">
                {printPreviewRows(sampleKind).map((row) => (
                  <div className="print-preview-row" key={`${sampleKind}-${row.label}`}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
              {isCard && (
                <section className="print-preview-checklist" aria-label="10 ô đánh dấu lượt sử dụng">
                  <div className="print-preview-checklist-grid">
                    {Array.from({ length: CARD_CHECKBOX_COUNT }, (_, index) => (
                      <i className="print-preview-check-box" key={`usage-check-${index}`} aria-hidden="true" />
                    ))}
                  </div>
                </section>
              )}
              {isCard && (
                <>
                  <p className="print-preview-facility-phone">
                    Số điện thoại cơ sở: {facilityPhone.trim() || '________________'}
                  </p>
                  <footer>Cảm ơn quý khách đã sử dụng dịch vụ</footer>
                </>
              )}
            </article>
            <figcaption>{figureCaption}</figcaption>
            <button
              type="button"
              className="btn ghost small print-preview-test"
              onClick={() => printSample(sampleKind, preview.title, sampleCaption)}
              aria-label={`In thử mẫu ${sampleCaption}, khổ ${paperLabel}`}
              data-testid={`button-print-preview-${sampleKind}`}
            >
              <Printer size={14} aria-hidden="true" /> In thử {sampleCaption.toLocaleLowerCase('vi')}
            </button>
          </figure>
          );
        })}
      </div>
      {printFeedback && (
        <p className={`print-preview-feedback ${printFeedback.kind === 'error' ? 'is-error' : 'is-success'}`} role={printFeedback.kind === 'error' ? 'alert' : 'status'}>
          {printFeedback.message}
        </p>
      )}
      <p className="print-preview-note">Mua và nạp thẻ dùng chung mẫu in; chỉ số giờ và ngày giao dịch thay đổi. Bản xem trước theo khổ đã chọn; hộp thoại thiết bị chọn máy in thực tế.</p>
    </section>
  );
}
