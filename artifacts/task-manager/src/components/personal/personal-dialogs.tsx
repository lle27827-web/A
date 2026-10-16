import { useState } from 'react';
import type { PersonalService, PersonalServiceInput, PersonalSession, PersonalSessionInput } from '@workspace/api-client-react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { Modal } from '@/components/modal';
import { formatMinutes, formatVnd, parseMoney } from '@/lib/massage';

export function PersonalServiceDialog({ service, busy, serverError, onClose, onSubmit }: {
  service: PersonalService | null; busy: boolean; serverError: string;
  onClose: () => void; onSubmit: (input: PersonalServiceInput) => void;
}) {
  const [name, setName] = useState(service?.name ?? '');
  const [rate, setRate] = useState(service ? String(service.hourlyRate) : '');
  const [error, setError] = useState('');
  function submit() {
    const n = name.trim();
    const r = parseMoney(rate);
    if (!n) return setError('Hãy nhập tên dịch vụ.');
    if (n.length > 120) return setError('Tên tối đa 120 ký tự.');
    if (r === null || r < 0 || r > 100_000_000) return setError('Giá theo giờ phải là số tiền hợp lệ (0 – 100.000.000 ₫).');
    setError('');
    onSubmit({ name: n, hourlyRate: r });
  }
  return (
    <Modal title={service ? 'Sửa dịch vụ của tôi' : 'Thêm dịch vụ của tôi'} description="Giá công theo giờ chỉ dùng cho sổ cá nhân của bạn." onClose={onClose} testId="dialog-personal-service">
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="field">Tên dịch vụ
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus placeholder="VD: Massage body đá nóng" data-testid="input-personal-service-name" />
        </label>
        <label className="field">Tiền công mỗi giờ (₫)
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="numeric" placeholder="VD: 85.000" data-testid="input-personal-service-rate" />
          {parseMoney(rate) !== null && <span className="hint">= {formatVnd(parseMoney(rate) ?? 0)} / giờ</span>}
        </label>
        {service && <p className="hint">Đổi giá chỉ áp dụng cho ca mới; ca cũ giữ giá đã ghi.</p>}
        {(error || serverError) && <p className="form-error" role="alert" data-testid="text-dialog-error"><AlertCircle size={14} />{error || serverError}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy} data-testid="button-save-personal-service">{busy && <LoaderCircle size={14} className="spin" />}Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

const QUICK = [30, 60, 90, 120];

export function PersonalShiftDialog({ session, services, defaultDate, maxDate, busy, serverError, onClose, onSubmit }: {
  session: PersonalSession | null; services: PersonalService[]; defaultDate: string; maxDate: string; busy: boolean; serverError: string;
  onClose: () => void; onSubmit: (input: PersonalSessionInput) => void;
}) {
  const archived = session && !services.some((s) => s.id === session.serviceId)
    ? { id: session.serviceId, name: session.serviceName, hourlyRate: session.hourlyRate } : null;
  const options = archived ? [archived, ...services] : services;
  const [serviceId, setServiceId] = useState(String(session?.serviceId ?? services[0]?.id ?? ''));
  const [date, setDate] = useState(session?.workDate ?? defaultDate);
  const [hours, setHours] = useState(session ? String(Math.floor(session.minutes / 60)) : '1');
  const [mins, setMins] = useState(session ? String(session.minutes % 60) : '0');
  const [note, setNote] = useState(session?.note ?? '');
  const [error, setError] = useState('');
  const total = (Number(hours) || 0) * 60 + (Number(mins) || 0);
  const chosen = options.find((o) => String(o.id) === serviceId);
  const keepsOldRate = session && chosen && chosen.id === session.serviceId;
  const rate = keepsOldRate ? session.hourlyRate : chosen?.hourlyRate ?? 0;

  function setTotal(m: number) { setHours(String(Math.floor(m / 60))); setMins(String(m % 60)); }
  function submit() {
    if (!chosen) return setError('Hãy chọn dịch vụ.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Hãy chọn ngày làm.');
    if (date > maxDate) return setError('Không thể ghi ca cho ngày trong tương lai.');
    if (!/^\d*$/.test(hours) || !/^\d*$/.test(mins) || !Number.isInteger(total) || total < 1 || total > 1440) return setError('Thời lượng phải từ 1 phút đến 24 giờ.');
    if (note.length > 2000) return setError('Ghi chú tối đa 2000 ký tự.');
    setError('');
    onSubmit({ serviceId: chosen.id, workDate: date, minutes: total, note: note.trim() });
  }
  return (
    <Modal title={session ? 'Sửa ca của tôi' : 'Ghi ca của tôi'} description="Chỉ lưu vào sổ cá nhân, không ảnh hưởng dữ liệu cơ sở." onClose={onClose} testId="dialog-personal-shift">
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="field">Dịch vụ
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} data-testid="select-personal-service">
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}{archived && o.id === archived.id ? ' (đã lưu trữ)' : ''} · {formatVnd(o.hourlyRate)}/giờ</option>)}
          </select>
        </label>
        <label className="field">Ngày làm
          <input type="date" value={date} max={maxDate} onChange={(e) => { setDate(e.target.value); setError(''); }} data-testid="input-personal-date" />
        </label>
        <div className="field-row">
          <label className="field">Giờ<input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} data-testid="input-personal-hours" /></label>
          <label className="field">Phút<input inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} data-testid="input-personal-minutes" /></label>
        </div>
        <div className="chip-row" role="group" aria-label="Chọn nhanh thời lượng">
          {QUICK.map((m) => <button key={m} type="button" className={`chip pad ${total === m ? 'active' : ''}`} onClick={() => setTotal(m)} data-testid={`button-quick-${m}`}>{formatMinutes(m)}</button>)}
        </div>
        <label className="field">Ghi chú
          <textarea rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Khách, phòng, tip…" data-testid="input-personal-note" />
        </label>
        <p className="card-hint" data-testid="text-personal-preview">
          {total > 0 ? <>{formatMinutes(total)} × {formatVnd(rate)}/giờ = <strong>{formatVnd((total / 60) * rate)}</strong></> : 'Nhập thời lượng để xem tiền công.'}
          {keepsOldRate && <><br /><span className="muted">Giữ giá đã ghi lúc tạo ca.</span></>}
        </p>
        {(error || serverError) && <p className="form-error" role="alert" data-testid="text-dialog-error"><AlertCircle size={14} />{error || serverError}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy} data-testid="button-save-personal-shift">{busy && <LoaderCircle size={14} className="spin" />}Lưu ca</button>
        </div>
      </form>
    </Modal>
  );
}
