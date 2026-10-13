import type { ServiceSession } from '@workspace/api-client-react';
import { Pencil, Trash2, UserX } from 'lucide-react';
import { Link } from 'wouter';
import { formatShortDate } from '@/lib/attendance';
import { formatMinutes, formatVnd } from '@/lib/massage';

export function SessionTable({ sessions, caption, canEdit, showDate, showTime, showEmployee, linkCards, visibleActions, busy, onEdit, onDelete, testId }: {
  sessions: ServiceSession[]; caption: string; canEdit: boolean; showDate?: boolean; showTime?: boolean; showEmployee?: boolean; linkCards?: boolean; visibleActions?: boolean; busy?: boolean;
  onEdit: (s: ServiceSession) => void; onDelete: (s: ServiceSession) => void; testId: string;
}) {
  return (
    <>
    <div className="table-wrap" role="region" aria-label={`${caption}. Bảng có thể cuộn sang ngang.`} tabIndex={0} data-testid={`table-${testId}`}>
      <table className="data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {showDate && <th scope="col">Ngày</th>}
            {showEmployee && <th scope="col">Kỹ thuật viên</th>}
            <th scope="col">Khách / dịch vụ</th>
            <th scope="col">Thời lượng</th>
            <th scope="col">Lương ca</th>
            <th scope="col">Ghi chú</th>
            {canEdit && !visibleActions && <th scope="col"><span className="sr-only">Thao tác</span></th>}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const orphan = s.memberId === null;
            return (
              <tr key={s.id} data-testid={`row-session-${s.id}`}>
                {showDate && <td className="mono nowrap"><time dateTime={s.workDate}>{formatShortDate(s.workDate)}</time>
                  {showTime && (() => {
                    const recordedAt = new Date(s.createdAt);
                    const hm = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(recordedAt);
                    const full = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'long', timeStyle: 'short' }).format(recordedAt);
                    return <span className="muted"><br /><time dateTime={s.createdAt} aria-label={`Giờ ghi ca: ${full}`} title={`Giờ ghi ca: ${full}`}>Ghi {hm}</time></span>;
                  })()}
                </td>}
                {showEmployee && <td className="nowrap">{orphan ? <span className="orphan"><UserX size={13} />{s.employeeName} (đã xóa)</span> : s.employeeName}</td>}
                <td>
                  <div className="cell-stack">
                    <strong>{s.customerName || 'Khách lẻ'}</strong>
                    <span className="muted">{s.serviceType}{s.cardId !== null && (linkCards ? <> · <Link href={`/cards/${s.cardId}`} className="link-strong">Thẻ #{s.cardId}</Link></> : <> · Thẻ #{s.cardId}</>)}</span>
                  </div>
                </td>
                <td className="mono nowrap">{formatMinutes(s.minutes)}</td>
                <td className="mono nowrap"><div className="cell-stack"><strong>{formatVnd(s.earnings)}</strong><span className="muted">{formatVnd(s.hourlyRate)}/giờ</span></div></td>
                <td className="note-cell">{s.note || '—'}</td>
                {canEdit && !visibleActions && (
                  <td>
                    <div className="row-actions">
                      {!orphan && <button type="button" className="icon-btn" onClick={() => onEdit(s)} aria-label={`Sửa ca ${s.id}`} data-testid={`button-edit-session-${s.id}`}><Pencil size={14} /></button>}
                      <button type="button" className="icon-btn danger" disabled={busy} onClick={() => onDelete(s)} aria-label={`Xóa ca ${s.id}`} data-testid={`button-delete-session-${s.id}`}><Trash2 size={14} /></button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {canEdit && visibleActions && (
      <ul className="emp-list" aria-label="Sửa hoặc xóa từng ca" data-testid={`actions-${testId}`}>
        {sessions.map((s) => (
          <li key={s.id} className="emp-row wrap">
            <span className="grow"><strong>{s.customerName || 'Khách lẻ'} · {s.serviceType}</strong><span className="muted mono">{formatMinutes(s.minutes)} · {formatShortDate(s.workDate)} · Ca #{s.id}{s.cardId !== null ? ` · Thẻ #${s.cardId}` : ''} · {formatVnd(s.earnings)}</span></span>
            <span className="head-actions">
              {s.memberId !== null && <button type="button" className="btn small" disabled={busy} onClick={() => onEdit(s)} aria-label={`Sửa ca ${s.id}: ${s.customerName || 'Khách lẻ'}, ${s.serviceType}, ${formatMinutes(s.minutes)}`} data-testid={`button-edit-session-${s.id}`}><Pencil size={14} />Sửa ca</button>}
              <button type="button" className="btn small danger" disabled={busy} onClick={() => onDelete(s)} aria-label={`Xóa ca ${s.id}: ${s.customerName || 'Khách lẻ'}, ${s.serviceType}, ${formatMinutes(s.minutes)}`} data-testid={`button-delete-session-${s.id}`}><Trash2 size={14} />Xóa ca</button>
            </span>
          </li>
        ))}
      </ul>
    )}
    </>
  );
}
