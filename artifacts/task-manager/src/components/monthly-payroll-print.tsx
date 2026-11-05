import { useMemo, useState } from 'react';
import {
  getListMembersQueryKey,
  getListServiceSessionsQueryKey,
  getListServiceTypesQueryKey,
  useListMembers,
  useListServiceSessions,
  useListServiceTypes,
} from '@workspace/api-client-react';
import { Download, Printer } from 'lucide-react';
import { formatMonth, formatVnd, SESSION_FRESHNESS } from '@/lib/massage';
import { vietnamToday } from '@/lib/revenue-period';
import { printHtmlInWindow, reservePrintWindow } from '@/lib/printing';
import { buildMonthlyPayrollReport, type MonthlyPayrollReport, type PayrollCell, type PayrollServiceColumn } from '@/lib/monthly-payroll-report';

function formatServicePayRate(service: PayrollServiceColumn): string {
  const rates = [...new Set(service.hourlyRates)].sort((a, b) => a - b);
  if (rates.length === 0) return 'Chưa có mức công';
  const label = rates.length === 1 ? 'Tiền công/giờ' : 'Các mức công/giờ';
  return `${label}: ${rates.map(formatVnd).join(' · ')}`;
}

function serviceCellText(cell: Pick<PayrollCell, 'sessions' | 'earnings'>): string {
  return `${cell.sessions} ca · ${formatVnd(cell.earnings)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function buildPrintHtml(report: MonthlyPayrollReport, month: string): string {
  const serviceHeaders = report.services.map((service) =>
    `<th scope="col"><strong>${escapeHtml(service.name)}</strong><small class="service-rate">${escapeHtml(formatServicePayRate(service))}</small></th>`,
  ).join('');
  const rows = report.rows.map((row) => {
    const serviceCells = row.services.map((cell) =>
      `<td class="service-cell"><span>${cell.sessions} ca</span><strong>${formatVnd(cell.earnings)}</strong></td>`,
    ).join('');
    return `<tr><th scope="row">${escapeHtml(row.employeeName)}</th>${serviceCells}<td class="total-money">${formatVnd(row.total.earnings)}</td></tr>`;
  }).join('');
  const totalCells = report.services.map((_, index) => {
    const total = report.rows.reduce((acc, row) => ({
      sessions: acc.sessions + row.services[index]!.sessions,
      earnings: acc.earnings + row.services[index]!.earnings,
    }), { sessions: 0, earnings: 0 });
    return `<td class="service-cell"><span>${total.sessions} ca</span><strong>${formatVnd(total.earnings)}</strong></td>`;
  }).join('');
  const title = `Tổng công nhân viên · ${formatMonth(month)}`;

  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #2b2116; font: 10pt/1.35 Arial, sans-serif; }
  h1 { margin: 0 0 4mm; text-align: center; font-size: 22pt; font-weight: 800; }
  .month { margin: 0 0 5mm; text-align: center; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th, td { padding: 2.2mm 1.5mm; border: 1px solid #6f5438; vertical-align: middle; text-align: center; }
  thead th { background: #eee8dc; font-weight: 700; }
  tbody th { min-width: 30mm; }
  .service-rate { display: block; margin-top: 1mm; font-size: 7.5pt; font-weight: 400; }
  .service-cell span, .service-cell strong { display: block; }
  .service-cell strong, .total-money { font-weight: 700; white-space: nowrap; }
  tfoot th, tfoot td { background: #e7e2d8; font-weight: 700; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body>
<h1>Tổng công nhân viên</h1><p class="month">${escapeHtml(formatMonth(month))}</p>
<table><thead><tr><th scope="col">Nhân viên</th>${serviceHeaders}<th scope="col">Tổng tiền công</th></tr></thead>
<tbody>${rows || `<tr><td colspan="${report.services.length + 2}">Tháng này chưa có dữ liệu chấm công.</td></tr>`}</tbody>
<tfoot><tr><th scope="row">Tổng cộng</th>${totalCells}<td class="total-money">${formatVnd(report.total.earnings)}</td></tr></tfoot>
</table></body></html>`;
}

export function MonthlyPayrollPrint({ enabled }: { enabled: boolean }) {
  const [today] = useState(vietnamToday);
  const currentMonth = today.slice(0, 7);
  const minMonth = `${String(Number(today.slice(0, 4)) - 5)}-${today.slice(5, 7)}`;
  const [month, setMonth] = useState(currentMonth);
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const params = useMemo(() => ({ month }), [month]);
  const membersQuery = useListMembers(params, {
    query: { queryKey: getListMembersQueryKey(params), enabled, ...SESSION_FRESHNESS },
  });
  const sessionsQuery = useListServiceSessions(params, {
    query: { queryKey: getListServiceSessionsQueryKey(params), enabled, ...SESSION_FRESHNESS },
  });
  const serviceTypesQuery = useListServiceTypes({
    query: { queryKey: getListServiceTypesQueryKey(), enabled, ...SESSION_FRESHNESS },
  });

  const report = useMemo(
    () => buildMonthlyPayrollReport(
      membersQuery.data ?? [],
      sessionsQuery.data ?? [],
      serviceTypesQuery.data ?? [],
      month,
    ),
    [membersQuery.data, sessionsQuery.data, serviceTypesQuery.data, month],
  );
  const isLoading = membersQuery.isLoading || sessionsQuery.isLoading || serviceTypesQuery.isLoading;
  const hasError = membersQuery.isError || sessionsQuery.isError || serviceTypesQuery.isError;

  function printReport() {
    setFeedback('');
    const printWindow = reservePrintWindow();
    if (!printWindow) {
      setFeedback('Trình duyệt đã chặn cửa sổ in. Hãy cho phép cửa sổ bật lên rồi thử lại.');
      return;
    }
    let printed = false;
    try {
      printed = printHtmlInWindow(printWindow, buildPrintHtml(report, month));
    } catch {
      printed = false;
    }
    if (!printed) {
      if (!printWindow.closed) printWindow.close();
      setFeedback('Không thể mở mẫu in. Vui lòng thử lại.');
      return;
    }
    setFeedback('Đã mở bảng in. Chọn máy in trong hộp thoại để in.');
  }

  async function downloadWorkbook() {
    setExporting(true);
    setFeedback('');
    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'SỔ CÔNG';
      workbook.subject = `Bảng tổng công nhân viên ${month}`;
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet('Tổng công', {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
      });
      const columnCount = report.services.length + 2;
      worksheet.mergeCells(1, 1, 1, columnCount);
      const titleCell = worksheet.getCell(1, 1);
      titleCell.value = `Tổng công nhân viên · ${formatMonth(month)}`;
      titleCell.font = { bold: true, size: 20, color: { argb: 'FF3C2B18' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 34;
      worksheet.addRow([
        'Nhân viên',
        ...report.services.map((service) => `${service.name}\n${formatServicePayRate(service)}`),
        'Tổng tiền công',
      ]);

      for (const row of report.rows) {
        const values: (string | number)[] = [
          row.employeeName,
          ...row.services.map(serviceCellText),
          row.total.earnings,
        ];
        worksheet.addRow(values);
      }
      const totalRow: (string | number)[] = ['Tổng cộng'];
      for (let index = 0; index < report.services.length; index += 1) {
        const cell = report.rows.reduce((sum, row) => ({
          sessions: sum.sessions + row.services[index]!.sessions,
          earnings: sum.earnings + row.services[index]!.earnings,
        }), { sessions: 0, earnings: 0 });
        totalRow.push(serviceCellText(cell));
      }
      totalRow.push(report.total.earnings);
      const totalExcelRow = worksheet.addRow(totalRow);

      worksheet.getColumn(1).width = 26;
      report.services.forEach((_, index) => {
        worksheet.getColumn(index + 2).width = 28;
      });
      worksheet.getColumn(columnCount).width = 22;

      const headerRow = worksheet.getRow(2);
      headerRow.height = 40;
      headerRow.font = { bold: true, color: { argb: 'FF3C2B18' } };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      headerRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECE7DC' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF80613B' } },
          bottom: { style: 'thin', color: { argb: 'FF80613B' } },
          left: { style: 'thin', color: { argb: 'FF80613B' } },
          right: { style: 'thin', color: { argb: 'FF80613B' } },
        };
      });
      for (let rowIndex = 3; rowIndex <= totalExcelRow.number; rowIndex += 1) {
        const row = worksheet.getRow(rowIndex);
        row.eachCell((cell, columnIndex) => {
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.border = {
            bottom: { style: 'hair', color: { argb: 'FFD0C6B5' } },
            left: { style: 'hair', color: { argb: 'FFD0C6B5' } },
            right: { style: 'hair', color: { argb: 'FFD0C6B5' } },
          };
          if (columnIndex === columnCount) cell.numFmt = '#,##0" ₫"';
        });
      }
      totalExcelRow.font = { bold: true, color: { argb: 'FF3C2B18' } };
      totalExcelRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E2D8' } };
        cell.border = {
          top: { style: 'double', color: { argb: 'FF80613B' } },
          bottom: { style: 'thin', color: { argb: 'FF80613B' } },
        };
      });
      worksheet.autoFilter = {
        from: { row: 2, column: 1 },
        to: { row: Math.max(2, totalExcelRow.number - 1), column: columnCount },
      };
      const buffer = await workbook.xlsx.writeBuffer();
      const file = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `tong-cong-nhan-vien-${month}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setFeedback('Đã tải bảng Excel tổng công nhân viên.');
    } catch {
      setFeedback('Không tạo được tệp Excel. Vui lòng thử lại.');
    } finally {
      setExporting(false);
    }
  }

  if (!enabled) return null;

  return (
    <section className="payroll-print-report" aria-labelledby="monthly-payroll-print-title">
      <div className="payroll-print-heading">
        <div>
          <h4 id="monthly-payroll-print-title">Tổng công nhân viên</h4>
          <p className="muted">Theo tháng, nhân viên và từng loại dịch vụ</p>
        </div>
        <label className="field payroll-month-field" htmlFor="monthly-payroll-month">
          Tháng
          <input id="monthly-payroll-month" type="month" min={minMonth} max={currentMonth} required
            value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} />
        </label>
      </div>

      {isLoading ? <p role="status" className="muted">Đang tải dữ liệu tháng…</p> : hasError ? (
        <div className="payroll-report-error" role="alert">
          <span>Không tải được bảng tổng công.</span>
          <button type="button" className="btn small" onClick={() => {
            void membersQuery.refetch();
            void sessionsQuery.refetch();
            void serviceTypesQuery.refetch();
          }}>Thử lại</button>
        </div>
      ) : (
        <>
          <div className="payroll-report-table-scroll" role="region" aria-label={`Bảng tổng công ${formatMonth(month)}`} tabIndex={0}>
            <table className="payroll-report-table">
              <thead>
                <tr>
                  <th scope="col">Nhân viên</th>
                  {report.services.map((service) => (
                    <th key={service.key} scope="col">
                      <strong>{service.name}</strong>
                      <span className="payroll-service-rate">{formatServicePayRate(service)}</span>
                    </th>
                  ))}
                  <th scope="col">Tổng tiền công</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.memberId}>
                    <th scope="row">{row.employeeName}</th>
                    {row.services.map((cell, index) => (
                      <PayrollServiceCell key={`${row.memberId}-${report.services[index]!.key}`} cell={cell} />
                    ))}
                    <td className="money">{formatVnd(row.total.earnings)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Tổng cộng</th>
                  {report.services.map((service, index) => {
                    const total = report.rows.reduce((sum, row) => ({
                      sessions: sum.sessions + row.services[index]!.sessions,
                      earnings: sum.earnings + row.services[index]!.earnings,
                    }), { sessions: 0, earnings: 0 });
                    return <PayrollServiceCell key={`total-${service.key}`} cell={total} />;
                  })}
                  <td className="money">{formatVnd(report.total.earnings)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="payroll-report-total" aria-label="Tổng toàn bộ nhân viên">
            {report.rows.length} nhân viên · Tổng tiền công {formatVnd(report.total.earnings)}
          </div>
        </>
      )}

      <div className="payroll-report-actions">
        <button type="button" className="btn small" onClick={printReport} disabled={isLoading || hasError}>
          <Printer size={15} aria-hidden="true" /> In bảng
        </button>
        <button type="button" className="btn small" onClick={() => void downloadWorkbook()} disabled={isLoading || hasError || exporting}>
          <Download size={15} aria-hidden="true" />{exporting ? 'Đang tạo Excel…' : 'Tải Excel'}
        </button>
      </div>
      {feedback && <p className="payroll-report-feedback" role="status">{feedback}</p>}
    </section>
  );
}

function PayrollServiceCell({ cell }: { cell: Pick<PayrollCell, 'sessions' | 'earnings'> }) {
  return (
    <td className="payroll-service-cell">
      <span>{cell.sessions} ca</span>
      <strong>{formatVnd(cell.earnings)}</strong>
    </td>
  );
}
