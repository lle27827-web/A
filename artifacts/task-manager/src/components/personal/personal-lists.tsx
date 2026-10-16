import type { PersonalService, PersonalSession } from '@workspace/api-client-react';
import { CalendarDays, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { formatShortDate } from '@/lib/attendance';
import { formatMinutes, formatVnd } from '@/lib/massage';

export function ServiceList({ services, busy, useFacility, settingBusy, settingError, onToggleFacility, onAdd, onEdit, onDelete }: {
  services: PersonalService[]; busy: boolean;
  useFacility: boolean; settingBusy: boolean; settingError: string; onToggleFacility: (next: boolean) => void;
  onAdd: () => void; onEdit: (s: PersonalService) => void; onDelete: (s: PersonalService) => void;
}) {
  return (
    <section className="p-card" aria-labelledby="p-services" data-testid="section-personal-services">
      <div className="panel-head wrap">
        <div><h2 id="p-services"><Sparkles size={16} aria-hidden="true" />Dịch vụ &amp; giá của tôi <span className="count">{services.length}</span></h2></div>
        {!useFacility && <button type="button" className="btn small" onClick={onAdd} data-testid="button-add-personal-service"><Plus size={14} />Thêm dịch vụ</button>}
      </div>
      <label className="p-switch" data-testid="label-use-facility-rates">
        <input type="checkbox" role="switch" aria-label="Dùng dịch vụ và tiền công của cơ sở" checked={useFacility} disabled={settingBusy} aria-busy={settingBusy}
          onChange={(e) => onToggleFacility(e.target.checked)} data-testid="switch-use-facility-rates" />
        <span className="p-switch-track" aria-hidden="true"><span /></span>
        <span className="grow"><strong>Dùng dịch vụ và tiền công của cơ sở</strong></span>
      </label>
      {settingError && <p className="form-error" role="alert" data-testid="text-facility-setting-error">{settingError}</p>}
      {services.length === 0 ? (
        <div className="empty small"><Sparkles size={18} /><p>{useFacility ? 'Cơ sở chưa có dịch vụ nào.' : 'Chưa có dịch vụ. Thêm dịch vụ và giá theo giờ trước khi ghi ca.'}</p></div>
      ) : (
        <ul className="p-list">
          {services.map((s) => (
            <li key={s.id} className="p-row" data-testid={`row-personal-service-${s.id}`}>
              <span className="grow"><strong>{s.name}</strong><span className="muted mono">{formatVnd(s.hourlyRate)} / giờ</span></span>
              {useFacility ? <span className="p-pill" data-testid={`text-facility-service-${s.id}`}>Cơ sở</span> : (
              <span className="head-actions">
                <button type="button" className="btn small" onClick={() => onEdit(s)} data-testid={`button-edit-personal-service-${s.id}`}><Pencil size={13} />Sửa</button>
                <button type="button" className="btn small ghost danger-text" disabled={busy} onClick={() => onDelete(s)} data-testid={`button-delete-personal-service-${s.id}`}><Trash2 size={13} />Xóa</button>
              </span>)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ShiftList({ title, sessions, busy, emptyText, onEdit, onDelete, testId }: {
  title?: string; sessions: PersonalSession[]; busy: boolean; emptyText: string;
  onEdit: (s: PersonalSession) => void; onDelete: (s: PersonalSession) => void; testId: string;
}) {
  return (
    <div data-testid={`list-${testId}`}>
      {title && <h3 className="group-title">{title}</h3>}
      {sessions.length === 0 ? (
        <div className="empty small"><CalendarDays size={18} /><p>{emptyText}</p></div>
      ) : (
        <ul className="p-list">
          {sessions.map((s) => (
            <li key={s.id} className="p-row" data-testid={`row-personal-shift-${s.id}`}>
              <span className="p-date mono">{formatShortDate(s.workDate)}</span>
              <span className="grow">
                <strong>{s.serviceName}</strong>
                {s.customerName && <span className="small" data-testid={`text-personal-shift-customer-${s.id}`}>Khách: {s.customerName}</span>}
                <span className="muted mono">{formatMinutes(s.minutes)} · {formatVnd(s.hourlyRate)}/giờ</span>
                {s.note && <span className="muted p-note">{s.note}</span>}
              </span>
              <strong className="mono p-earn">{formatVnd(s.earnings)}</strong>
              <span className="head-actions">
                <button type="button" className="btn small" onClick={() => onEdit(s)} data-testid={`button-edit-personal-shift-${s.id}`}><Pencil size={13} />Sửa</button>
                <button type="button" className="btn small ghost danger-text" disabled={busy} onClick={() => onDelete(s)} data-testid={`button-delete-personal-shift-${s.id}`}><Trash2 size={13} />Xóa</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
