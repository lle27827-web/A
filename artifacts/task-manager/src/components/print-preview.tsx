import {
  CARD_CHECKBOX_COUNT,
  getPrintPageLayout,
  PRINT_PAPER_OPTIONS,
  printPreviewRows,
  type PrintPaperSize,
} from '@/lib/printing';

export function PrintPreview({ paperSize, customWidthMm, customHeightMm, facilityPhone }: {
  paperSize: PrintPaperSize;
  customWidthMm: number;
  customHeightMm: number;
  facilityPhone: string;
}) {
  const paperLabel = PRINT_PAPER_OPTIONS.find((option) => option.value === paperSize)?.label ?? 'Khổ giấy';
  const layout = getPrintPageLayout(paperSize, customWidthMm, customHeightMm);
  const previews = [
    { kind: 'sale' as const, title: 'Thẻ khách hàng', caption: 'Bán thẻ' },
    { kind: 'topup' as const, title: 'Thẻ khách hàng', caption: 'Nạp thẻ' },
    { kind: 'session' as const, title: 'Phiếu chấm công', caption: 'Phiếu chấm công' },
  ];

  return (
    <section className="print-preview-area" aria-labelledby="print-preview-title">
      <div className="print-preview-heading">
        <h4 id="print-preview-title">Xem trước phiếu in</h4>
        <span>{paperLabel}</span>
      </div>
      <div className="print-preview-grid">
        {previews.map((preview) => (
          <figure className="print-preview-figure" key={preview.kind}>
            <article
              className={`print-preview-sheet print-preview-sheet--${paperSize}`}
              style={{
                width: `${layout.previewWidthPx}px`,
                aspectRatio: `${layout.widthMm} / ${layout.heightMm}`,
                fontSize: `${layout.previewFontPx}px`,
              }}
              aria-label={`Xem trước ${preview.caption}, ${paperLabel}${paperSize === 'custom' ? `, ${layout.widthMm} nhân ${layout.heightMm} milimét` : ''}`}
              data-testid={`print-preview-${preview.kind}`}
            >
              <header className="print-preview-sheet-header">
                <span>{preview.title}</span>
              </header>
              <div className="print-preview-rows">
                {printPreviewRows(preview.kind).map((row) => (
                  <div className="print-preview-row" key={`${preview.kind}-${row.label}`}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
              {preview.kind !== 'session' && (
                <section className="print-preview-checklist" aria-label="10 ô đánh dấu lượt sử dụng">
                  <div className="print-preview-checklist-grid">
                    {Array.from({ length: CARD_CHECKBOX_COUNT }, (_, index) => (
                      <i className="print-preview-check-box" key={`usage-check-${index}`} aria-hidden="true" />
                    ))}
                  </div>
                </section>
              )}
              {preview.kind !== 'session' && (
                <>
                  <p className="print-preview-facility-phone">
                    Số điện thoại cơ sở: {facilityPhone.trim() || '________________'}
                  </p>
                  <footer>Cảm ơn quý khách đã sử dụng dịch vụ</footer>
                </>
              )}
            </article>
            <figcaption>{preview.caption}</figcaption>
          </figure>
        ))}
      </div>
      <p className="print-preview-note">Bản xem trước theo đúng tỷ lệ khổ giấy đã chọn. Kích thước in thực tế và khổ máy hỗ trợ được chọn trong hộp thoại in của thiết bị.</p>
    </section>
  );
}
