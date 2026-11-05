import type { ServiceSession } from '@workspace/api-client-react';
import { Pencil, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import { formatShortDate } from '@/lib/attendance';
import { formatMinutes } from '@/lib/massage';

/** Detailed attendance rows for one employee, with customer, service and duration always visible. */
export function SessionRows({ sessions, title, canEditRow, linkCards, busy, onEdit, onDelete, testId }: {
  sessions: ServiceSession[]; title: string; canEditRow: (s: ServiceSession) => boolean; linkCards?: boolean; busy?: boolean;
  onEdit: (s: ServiceSession) => void; onDelete: (s: ServiceSession) => void; testId: string;
}) {
  return (
    <ul className="shift-rows" aria-label={title} data-testid={`list-${testId}`}>
      {sessions.map((s) => {
        const editable = canEditRow(s);
        const isCardVisit = s.cardId !== null;
        const customer = isCardVisit
          ? (s.customerName || 'Khách dùng thẻ')
          : (s.customerName || 'Khách lẻ');
        return (
          <li key={s.id} className="shift-row employee-session-row" data-testid={`row-session-${s.id}`}>
            <div className="shift-main employee-session-line">
              <time className="shift-date mono" dateTime={s.workDate}>{formatShortDate(s.workDate)}</time>
              <span className="employee-session-separator" aria-hidden="true">·</span>
              <span className="employee-session-customer">
                <span className="sr-only">{isCardVisit ? 'Khách thẻ: ' : 'Khách lẻ: '}</span>
                <strong>{customer}</strong>
                {isCardVisit && linkCards && <> · <Link href={`/cards/${s.cardId}`} className="link-strong" data-testid={`link-session-card-${s.id}`}>Xem thẻ</Link></>}
              </span>
              <span className="employee-session-separator" aria-hidden="true">·</span>
              <strong className="shift-service">{s.serviceType || 'Không tên'}</strong>
              <span className="employee-session-separator" aria-hidden="true">·</span>
              <span className="employee-session-duration"><span className="sr-only">Thời lượng: </span><strong className="mono">{formatMinutes(s.minutes)}</strong></span>
            </div>
            {editable && (
              <div className="row-actions text-actions shift-actions">
                {s.memberId !== null && <button type="button" className="btn small" disabled={busy} onClick={() => onEdit(s)} aria-label={`Sửa ca ${customer}, ${s.serviceType}, ${formatMinutes(s.minutes)}`} data-testid={`button-edit-session-${s.id}`}><Pencil size={14} aria-hidden="true" />Sửa</button>}
                <button type="button" className="btn small danger" disabled={busy} onClick={() => onDelete(s)} aria-label={`Xóa ca ${customer}, ${s.serviceType}, ${formatMinutes(s.minutes)}`} data-testid={`button-delete-session-${s.id}`}><Trash2 size={14} aria-hidden="true" />Xóa</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
