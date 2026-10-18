import { useEffect, useRef, useState } from 'react';
import type { PersonalService, PersonalServiceInput, PersonalSession, PersonalSessionInput } from '@workspace/api-client-react';
import { AlertCircle, CalendarDays, LoaderCircle } from 'lucide-react';
import { Modal } from '@/components/modal';
import { DatePickerDialog } from '@/components/date-picker-dialog';
import { VoiceInput } from '@/components/voice-input';
import { DurationInputs } from '@/components/duration-inputs';
import { formatShortDate } from '@/lib/attendance';
import { formatMinutes, formatVnd, parseHoursAndMinutes, parseMoney } from '@/lib/massage';

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
    <Modal title={service ? 'Sửa dịch vụ của tôi' : 'Thêm dịch vụ của tôi'} onClose={onClose} testId="dialog-personal-service">
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="field">Tên dịch vụ
          <VoiceInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus placeholder="VD: Massage body đá nóng" data-testid="input-personal-service-name" />
        </label>
        <label className="field">Tiền công mỗi giờ (₫)
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="numeric" placeholder="VD: 85.000" data-testid="input-personal-service-rate" />
          {parseMoney(rate) !== null && <span className="hint">= {formatVnd(parseMoney(rate) ?? 0)} / giờ</span>}
        </label>
        {(error || serverError) && <p className="form-error" role="alert" data-testid="text-dialog-error"><AlertCircle size={14} />{error || serverError}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy} data-testid="button-save-personal-service">{busy && <LoaderCircle size={14} className="spin" />}Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

export function PersonalShiftDialog({ session, services, defaultDate, maxDate, busy, serverError, onClose, onSubmit }: {
  session: PersonalSession | null; services: PersonalService[]; defaultDate: string; maxDate: string; busy: boolean; serverError: string;
  onClose: () => void; onSubmit: (input: PersonalSessionInput) => void;
}) {
  const archived = session && !services.some((s) => s.id === session.serviceId)
    ? { id: session.serviceId, name: session.serviceName, hourlyRate: session.hourlyRate } : null;
  const options = archived ? [archived, ...services] : services;
  const [serviceId, setServiceId] = useState(String(session?.serviceId ?? services[0]?.id ?? ''));
  const [date, setDate] = useState(session?.workDate ?? defaultDate);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [hours, setHours] = useState(session ? String(Math.floor(session.minutes / 60)) : '1');
  const [extraMinutes, setExtraMinutes] = useState(session ? String(session.minutes % 60) : '0');
  const note = session?.note ?? '';
  const [customerName, setCustomerName] = useState(session?.customerName ?? '');
  const [error, setError] = useState('');
  // One idempotency key per open "new shift" draft, reused on every retry.
  const [requestId] = useState(() => (session ? undefined : crypto.randomUUID()));
  const submitting = useRef(false);
  useEffect(() => { if (serverError) submitting.current = false; }, [serverError]);
  const total = parseHoursAndMinutes(hours, extraMinutes);
  const chosen = options.find((o) => String(o.id) === serviceId);
  const keepsOldRate = session && chosen && chosen.id === session.serviceId;
  const rate = keepsOldRate ? session.hourlyRate : chosen?.hourlyRate ?? 0;

  function submit() {
    if (busy || submitting.current) return;
    if (!chosen) return setError('Hãy chọn dịch vụ.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Hãy chọn ngày làm.');
    if (date > maxDate) return setError('Không thể ghi ca cho ngày trong tương lai.');
    if (total === null) return setError('Nhập số giờ từ 0 đến 24, số phút từ 0 đến 59; tổng thời lượng phải từ 1 phút đến 24 giờ.');
    if (customerName.trim().length > 160) return setError('Tên khách tối đa 160 ký tự.');
    setError('');
    submitting.current = true;
    onSubmit({ serviceId: chosen.id, workDate: date, minutes: total, note, customerName: customerName.trim(), ...(requestId ? { requestId } : {}) });
  }
  return (
    <Modal title={session ? 'Sửa ca của tôi' : 'Ghi ca của tôi'} onClose={onClose} testId="dialog-personal-shift">
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="field">Dịch vụ
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} data-testid="select-personal-service">
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}{archived && o.id === archived.id ? ' (đã lưu trữ)' : ''} · {formatVnd(o.hourlyRate)}/giờ</option>)}
          </select>
        </label>
        <div className="field">
          <span id="personal-date-label">Ngày làm</span>
          <button type="button" className="btn date-picker-trigger" aria-labelledby="personal-date-label personal-date-value" onClick={() => setDatePickerOpen(true)} data-testid="input-personal-date">
            <CalendarDays size={15} aria-hidden="true" /><span id="personal-date-value">{formatShortDate(date)}</span>
          </button>
        </div>
        <DurationInputs hours={hours} minutes={extraMinutes}
          onHoursChange={(value) => { setHours(value); setError(''); }}
          onMinutesChange={(value) => { setExtraMinutes(value); setError(''); }}
          hourId="personal-hours" minuteId="personal-minutes" prefix="personal"
          describedBy={total !== null ? 'personal-duration-hint' : undefined} />
        {total !== null && <span id="personal-duration-hint" className="hint" data-testid="text-personal-duration">
          {formatMinutes(total)} · Tiền công {formatVnd(Math.round(total * rate / 60))}
        </span>}
        <label className="field">Tên khách (không bắt buộc)
          <VoiceInput value={customerName} maxLength={160} onChange={(e) => setCustomerName(e.target.value)} placeholder="VD: Chị Lan" data-testid="input-personal-customer" />
        </label>
        {(error || serverError) && <p className="form-error" role="alert" data-testid="text-dialog-error"><AlertCircle size={14} />{error || serverError}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy} data-testid="button-save-personal-shift">{busy && <LoaderCircle size={14} className="spin" />}Lưu ca</button>
        </div>
      </form>
      {datePickerOpen && <DatePickerDialog value={date} title="Chọn ngày chấm công" immediate maxDate={maxDate} onClose={() => setDatePickerOpen(false)}
        onSelect={(next) => { setDate(next); setError(''); setDatePickerOpen(false); }} />}
    </Modal>
  );
}
