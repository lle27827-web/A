import type { ServiceSession } from '@workspace/api-client-react';
import { Pencil, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import { formatShortDate } from '@/lib/attendance';
import { formatMinutes, formatVnd } from '@/lib/massage';

/** Stacked, personal-notebook-style shift rows for one employee. */
export function SessionRows({ sessions, title, canEditRow, linkCards, busy, onEdit, onDelete, testId }: {
  sessions: ServiceSession[]; title: string; canEditRow: (s: ServiceSession) => boolean; linkCards?: boolean; busy?: boolean;
  onEdit: (s: ServiceSession) => void; onDelete: (s: ServiceSession) => void; testId: string;
}) {
  return (
    <ul className="shift-rows" aria-label={title} data-testid={`list-${testId}`}>
      {sessions.map((s) => {
        const editable = canEditRow(s);
        const customer = s.customerName || 'Khách lẻ';
        return (
          <li key={s.id} className="shift-row" data-testid={`row-session-${s.id}`}>
            <div className="shift-main">
              <span className="shift-date mono"><time dateTime={s.workDate}>{formatShortDate(s.workDate)}</time></span>
              <strong className="shift-service">{s.serviceType || 'Không tên'}</strong>
              <span className="shift-customer">
                {customer}
                {s.cardId !== null && (linkCards
                  ? <> · <Link href={`/cards/${s.cardId}`} className="link-strong" data-testid={`link-session-card-${s.id}`}>Thẻ #{s.cardId}</Link></>
                  : <> · Thẻ #{s.cardId}</>)}
              </span>
            </div>
            <dl className="shift-facts">
              <div><dt>Thời lượng</dt><dd className="mono">{formatMinutes(s.minutes)}</dd></div>
              <div><dt>Tiền công</dt><dd className="mono" data-testid={`text-session-pay-${s.id}`}>{formatVnd(s.earnings)}</dd></div>
              <div><dt>Tiền dịch vụ</dt><dd className="mono">{s.cardId !== null ? 'Tính khi bán thẻ' : formatVnd(s.customerCharge)}</dd></div>
            </dl>
            {s.note && <p className="shift-note">{s.note}</p>}
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
