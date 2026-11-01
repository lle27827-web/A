import {
  PRINT_PAPER_OPTIONS,
  hourChecklistLabels,
  printPreviewRows,
  type PrintPaperSize,
} from '@/lib/printing';

export function PrintPreview({ paperSize, facilityPhone }: {
  paperSize: PrintPaperSize;
  facilityPhone: string;
}) {
  const paperLabel = PRINT_PAPER_OPTIONS.find((option) => option.value === paperSize)?.label ?? 'Khổ giấy';
  const previews = [
    { kind: 'card' as const, title: 'Thẻ liệu trình khách hàng', caption: 'Thẻ khách hàng' },
    { kind: 'session' as const, title: 'Phiếu chấm công nhân viên', caption: 'Phiếu chấm công' },
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
              aria-label={`Xem trước ${preview.caption}, khổ ${paperLabel}`}
              data-testid={`print-preview-${preview.kind}`}
            >
              <header className="print-preview-sheet-header">
                <strong>SỔ CÔNG</strong>
                <span>{preview.title}</span>
              </header>
              <div className="print-preview-rows">
                {printPreviewRows(preview.kind, facilityPhone).map((row) => (
                  <div className="print-preview-row" key={`${preview.kind}-${row.label}`}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
              {preview.kind === 'card' && (
                <section className="print-preview-checklist" aria-label="Ví dụ ô đánh dấu giờ đã mua">
                  <strong>Đánh dấu giờ đã sử dụng</strong>
                  <div className={`print-preview-checklist-grid print-preview-checklist-grid--${paperSize}`}>
                    {hourChecklistLabels(300).map((label, index) => (
                      <span className="print-preview-check-cell" key={`${label}-${index}`}>
                        <i aria-hidden="true" />{label}
                      </span>
                    ))}
                  </div>
                </section>
              )}
              <footer>Cảm ơn quý khách</footer>
            </article>
            <figcaption>{preview.caption}</figcaption>
          </figure>
        ))}
      </div>
      <p className="print-preview-note">Đây là dữ liệu minh họa; bản in dùng thông tin thực tế của thẻ hoặc ca.</p>
    </section>
  );
}
