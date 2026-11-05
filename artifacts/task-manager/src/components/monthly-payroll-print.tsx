import { Fragment, useMemo, useState } from 'react';
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
import { reservePrintWindow } from '@/lib/printing';
import { buildMonthlyPayrollReport, type MonthlyPayrollReport } from '@/lib/monthly-payroll-report';

function formatHours(minutes: number): string {
  return (minutes / 60).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
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
    `<th colspan="3">${escapeHtml(service.name)}</th>`,
  ).join('');
  const subHeaders = report.services.map(() =>
    '<th>Số ca</th><th>Tổng giờ</th><th>Tiền công</th>',
  ).join('');
  const rows = report.rows.map((row) => {
    const serviceCells = row.services.map((cell) =>
      `<td class="number">${cell.sessions}</td><td class="number">${formatHours(cell.minutes)}</td><td class="money">${formatVnd(cell.earnings)}</td>`,
    ).join('');
    return `<tr><th scope="row">${escapeHtml(row.employeeName)}</th>${serviceCells}<td class="number">${row.total.sessions}</td><td class="number">${formatHours(row.total.minutes)}</td><td class="money">${formatVnd(row.total.earnings)}</td></tr>`;
  }).join('');
  const totalCells = report.services.map((_, index) => {
    const total = report.rows.reduce((acc, row) => ({
      sessions: acc.sessions + row.services[index]!.sessions,
      minutes: acc.minutes + row.services[index]!.minutes,
      earnings: acc.earnings + row.services[index]!.earnings,
    }), { sessions: 0, minutes: 0, earnings: 0 });
    return `<td class="number">${total.sessions}</td><td class="number">${formatHours(total.minutes)}</td><td class="money">${formatVnd(total.earnings)}</td>`;
  }).join('');
  const title = `Tổng công nhân viên · ${formatMonth(month)}`;

  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #2b2116; font: 10pt/1.35 Arial, sans-serif; }
  h1 { margin: 0 0 4mm; text-align: center; font-size: 16pt; }
  .month { margin: 0 0 5mm; text-align: center; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th, td { padding: 2.2mm 1.5mm; border: 1px solid #6f5438; vertical-align: middle; }
  thead th { background: #eee8dc; text-align: center; font-weight: 700; }
  tbody th { text-align: left; min-width: 30mm; }
  .number, .money { text-align: right; white-space: nowrap; }
  tfoot th, tfoot td { background: #e7e2d8; font-weight: 700; }
  tr { break-inside: avoid; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body>
<h1>Tổng công nhân viên</h1><p class="month">${escapeHtml(formatMonth(month))}</p>
<table><thead><tr><th rowspan="2">Nhân viên</th>${serviceHeaders}<th colspan="3">Tổng cộng</th></tr>
<tr>${subHeaders}<th>Số ca</th><th>Tổng giờ</th><th>Tiền công</th></tr></thead>
<tbody>${rows || `<tr><td colspan="${1 + report.services.length * 3 + 3}">Tháng này chưa có dữ liệu chấm công.</td></tr>`}</tbody>
<tfoot><tr><th>Tổng cộng</th>${totalCells}<td class="number">${report.total.sessions}</td><td class="number">${formatHours(report.total.minutes)}</td><td class="money">${formatVnd(report.total.earnings)}</td></tr></tfoot>
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
    try {
      printWindow.document.open();
      printWindow.document.write(buildPrintHtml(report, month));
      printWindow.document.close();
      printWindow.addEventListener('afterprint', () => {
        if (!printWindow.closed) printWindow.close();
      }, { once: true });
      window.setTimeout(() => {
        if (!printWindow.closed) {
          printWindow.focus();
          printWindow.print();
        }
      }, 250);
    } catch {
      if (!printWindow.closed) printWindow.close();
      setFeedback('Không thể mở mẫu in. Vui lòng thử lại.');
    }
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
        views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }],
      });
      const columnCount = report.services.length * 3 + 4;
      worksheet.mergeCells(1, 1, 1, columnCount);
      const titleCell = worksheet.getCell(1, 1);
      titleCell.value = `Tổng công nhân viên · ${formatMonth(month)}`;
      titleCell.font = { bold: true, size: 16, color: { argb: 'FF3C2B18' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 28;

      const topHeader: (string | number)[] = ['Nhân viên'];
      const secondHeader: (string | number)[] = [''];
      for (const service of report.services) {
        topHeader.push(service.name, '', '');
        secondHeader.push('Số ca', 'Tổng giờ', 'Tiền công');
      }
      topHeader.push('Tổng cộng', '', '');
      secondHeader.push('Số ca', 'Tổng giờ', 'Tiền công');
      worksheet.addRow(topHeader);
      worksheet.addRow(secondHeader);
      worksheet.mergeCells(2, 1, 3, 1);
      for (let index = 0; index < report.services.length; index += 1) {
        const firstColumn = 2 + index * 3;
        worksheet.mergeCells(2, firstColumn, 2, firstColumn + 2);
      }
      worksheet.mergeCells(2, 2 + report.services.length * 3, 2, columnCount);

      for (const row of report.rows) {
        const values: (string | number)[] = [row.employeeName];
        for (const cell of row.services) {
          values.push(cell.sessions, cell.minutes / 60, cell.earnings);
        }
        values.push(row.total.sessions, row.total.minutes / 60, row.total.earnings);
        worksheet.addRow(values);
      }
      const totalRow: (string | number)[] = ['Tổng cộng'];
      for (let index = 0; index < report.services.length; index += 1) {
        const cell = report.rows.reduce((sum, row) => ({
          sessions: sum.sessions + row.services[index]!.sessions,
          minutes: sum.minutes + row.services[index]!.minutes,
          earnings: sum.earnings + row.services[index]!.earnings,
        }), { sessions: 0, minutes: 0, earnings: 0 });
        totalRow.push(cell.sessions, cell.minutes / 60, cell.earnings);
      }
      totalRow.push(report.total.sessions, report.total.minutes / 60, report.total.earnings);
      const totalExcelRow = worksheet.addRow(totalRow);

      worksheet.getColumn(1).width = 26;
      for (let index = 0; index < report.services.length; index += 1) {
        const firstColumn = 2 + index * 3;
        worksheet.getColumn(firstColumn).width = 10;
        worksheet.getColumn(firstColumn + 1).width = 12;
        worksheet.getColumn(firstColumn + 2).width = 19;
      }
      const totalStartColumn = 2 + report.services.length * 3;
      worksheet.getColumn(totalStartColumn).width = 12;
      worksheet.getColumn(totalStartColumn + 1).width = 12;
      worksheet.getColumn(totalStartColumn + 2).width = 20;

      for (const rowIndex of [2, 3]) {
        const row = worksheet.getRow(rowIndex);
        row.height = rowIndex === 2 ? 24 : 22;
        row.font = { bold: true, color: { argb: 'FF3C2B18' } };
        row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECE7DC' } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF80613B' } },
            bottom: { style: 'thin', color: { argb: 'FF80613B' } },
            left: { style: 'thin', color: { argb: 'FF80613B' } },
            right: { style: 'thin', color: { argb: 'FF80613B' } },
          };
        });
      }
      for (let rowIndex = 4; rowIndex <= totalExcelRow.number; rowIndex += 1) {
        const row = worksheet.getRow(rowIndex);
        row.eachCell((cell, columnIndex) => {
          cell.border = {
            bottom: { style: 'hair', color: { argb: 'FFD0C6B5' } },
            left: { style: 'hair', color: { argb: 'FFD0C6B5' } },
            right: { style: 'hair', color: { argb: 'FFD0C6B5' } },
          };
          if (columnIndex > 1 && (columnIndex - 2) % 3 === 1) cell.numFmt = '0.##';
          if (columnIndex > 1 && (columnIndex - 2) % 3 === 2) cell.numFmt = '#,##0" ₫"';
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
        from: { row: 3, column: 1 },
        to: { row: Math.max(3, totalExcelRow.number - 1), column: columnCount },
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
          <h4 id="monthly-payroll-print-title">Bảng tổng công nhân viên</h4>
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
                  <th rowSpan={2} scope="col">Nhân viên</th>
                  {report.services.map((service) => <th key={service.key} colSpan={3} scope="colgroup">{service.name}</th>)}
                  <th colSpan={3} scope="colgroup">Tổng cộng</th>
                </tr>
                <tr>
                  {report.services.map((service) => (
                    <Fragment key={`subhead-${service.key}`}>
                      <th scope="col">Số ca</th><th scope="col">Tổng giờ</th><th scope="col">Tiền công</th>
                    </Fragment>
                  ))}
                  <th scope="col">Số ca</th><th scope="col">Tổng giờ</th><th scope="col">Tiền công</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.memberId}>
                    <th scope="row">{row.employeeName}</th>
                    {row.services.map((cell, index) => (
                      <PayrollCells key={`${row.memberId}-${report.services[index]!.key}`} cell={cell} />
                    ))}
                    <PayrollCells cell={row.total} />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Tổng cộng</th>
                  {report.services.map((service, index) => (
                    <PayrollCells key={`total-${service.key}`} cell={report.rows.reduce((sum, row) => ({
                      sessions: sum.sessions + row.services[index]!.sessions,
                      minutes: sum.minutes + row.services[index]!.minutes,
                      earnings: sum.earnings + row.services[index]!.earnings,
                    }), { sessions: 0, minutes: 0, earnings: 0 })} />
                  ))}
                  <PayrollCells cell={report.total} />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="payroll-report-total" aria-label="Tổng toàn bộ nhân viên">
            {report.rows.length} nhân viên · {report.total.sessions} ca · {formatHours(report.total.minutes)} giờ · {formatVnd(report.total.earnings)}
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

function PayrollCells({ cell }: { cell: { sessions: number; minutes: number; earnings: number } }) {
  return (
    <>
      <td className="number">{cell.sessions}</td>
      <td className="number">{formatHours(cell.minutes)}</td>
      <td className="money">{formatVnd(cell.earnings)}</td>
    </>
  );
}
