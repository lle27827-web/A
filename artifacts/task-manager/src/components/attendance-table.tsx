import type { AttendanceRecord } from '@workspace/api-client-react';
import { Pencil, Trash2 } from 'lucide-react';
import { formatShortDate, initial, statusLabel } from '@/lib/attendance';

export function AttendanceTable({ records, caption, canEdit, showDate, busy, onEdit, onDelete, testId }: {
  records: AttendanceRecord[];
  caption: string;
  canEdit: boolean;
  showDate: boolean;
  busy?: boolean;
  onEdit?: (record: AttendanceRecord) => void;
  onDelete?: (record: AttendanceRecord) => void;
  testId: string;
}) {
  const showActions = canEdit && onEdit && onDelete;
  return (
    <div className="table-wrap">
      <table className="data-table" data-testid={testId}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Nhân viên</th>
            {showDate && <th scope="col">Ngày</th>}
            <th scope="col">Tình trạng</th>
            <th scope="col">Vào ca</th>
            <th scope="col">Tan ca</th>
            {canEdit && <th scope="col"><span className="sr-only">Thao tác</span></th>}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} data-testid={`row-${testId}-${record.id}`}>
              <th scope="row"><span className="person-cell"><span className="initials" aria-hidden="true">{initial(record.employeeName)}</span>{record.employeeName}</span></th>
              {showDate && <td className="mono">{formatShortDate(record.workDate)}</td>}
              <td><span className={`status-chip ${record.status}`}><span className="dot" />{statusLabel(record.status)}</span></td>
              <td className="mono">{record.checkIn ?? <span className="muted">—</span>}</td>
              <td className="mono">{record.checkOut ?? <span className="muted">—</span>}</td>
              {showActions && (
                <td>
                  <div className="row-actions">
                    <button type="button" className="icon-btn" onClick={() => onEdit(record)} aria-label={`Sửa ca của ${record.employeeName} ngày ${formatShortDate(record.workDate)}`} data-testid={`button-edit-attendance-${record.id}`}><Pencil size={14} /></button>
                    <button type="button" className="icon-btn danger" onClick={() => onDelete(record)} disabled={busy} aria-label={`Xóa ca của ${record.employeeName} ngày ${formatShortDate(record.workDate)}`} data-testid={`button-delete-attendance-${record.id}`}><Trash2 size={14} /></button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableSkeleton({ label }: { label: string }) {
  return <div className="skeleton-list" role="status" aria-label={label}><span /><span /><span /><span /></div>;
}
