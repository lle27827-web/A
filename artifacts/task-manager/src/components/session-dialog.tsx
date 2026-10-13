import { useState, type FormEvent } from 'react';
import type { MemberRecord, ServiceSession, ServiceSessionInput, TreatmentCard } from '@workspace/api-client-react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { Modal } from '@/components/modal';
import { formatMinutes, formatVnd, hoursValue, parseHoursToMinutes } from '@/lib/massage';

export function SessionDialog({ session, members, cards, cardsLoading, defaultDate, defaultMemberId, fixedCardId, busy, serverError, onClose, onSubmit }: {
  session: ServiceSession | null;
  members: MemberRecord[];
  cards: TreatmentCard[];
  cardsLoading?: boolean;
  defaultDate: string;
  defaultMemberId?: number | null;
  fixedCardId?: number | null;
  busy: boolean;
  serverError: string;
  onClose: () => void;
  onSubmit: (input: ServiceSessionInput) => void;
}) {
  const [memberId, setMemberId] = useState(String(session?.memberId ?? defaultMemberId ?? ''));
  const [cardId, setCardId] = useState(String(session ? session.cardId ?? '' : fixedCardId ?? ''));
  const [date, setDate] = useState(session?.workDate ?? defaultDate);
  const [hours, setHours] = useState(session ? hoursValue(session.minutes) : '1');
  const [serviceType, setServiceType] = useState(session && session.cardId === null ? session.serviceType : '');
  const [customerName, setCustomerName] = useState(session && session.cardId === null ? session.customerName : '');
  const [note, setNote] = useState(session?.note ?? '');
  const [error, setError] = useState('');

  const member = members.find((m) => String(m.id) === memberId) ?? null;
  const card = cards.find((c) => String(c.id) === cardId) ?? null;
  const minutes = parseHoursToMinutes(hours);
  const effectiveRate = session && session.memberId === member?.id ? session.hourlyRate : member?.hourlyRate ?? 0;
  const rateMissing = member !== null && effectiveRate <= 0;
  const ownCardMinutes = session && session.cardId !== null && String(session.cardId) === cardId ? session.minutes : 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!member) return setError('Hãy chọn kỹ thuật viên.');
    if (rateMissing) return setError(`${member.name} chưa có lương theo giờ. Hãy đặt lương giờ cho nhân viên trước khi ghi ca phục vụ.`);
    if (!date) return setError('Hãy chọn ngày.');
    if (minutes === null || minutes < 1 || minutes > 1440) return setError('Số giờ phải lớn hơn 0 và không quá 24 giờ.');
    if (!cardId && !serviceType.trim()) return setError('Hãy nhập dịch vụ cho khách lẻ.');
    setError('');
    const input: ServiceSessionInput = { memberId: member.id, workDate: date, minutes, note: note.trim() };
    if (cardId) input.cardId = Number(cardId);
    else { input.cardId = null; input.serviceType = serviceType.trim(); input.customerName = customerName.trim(); }
    onSubmit(input);
  }

  const shown = error || serverError;
  return (
    <Modal title={session ? 'Sửa ca phục vụ' : 'Thêm ca phục vụ'} description="Một bản ghi duy nhất: trừ giờ thẻ (nếu có) và tính lương kỹ thuật viên." onClose={onClose} testId="dialog-session">
      <form className="form-grid" onSubmit={submit} noValidate>
        <div className="field-row">
          <label className="field" htmlFor="s-date">Ngày
            <input id="s-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required data-testid="input-session-date" />
          </label>
          <label className="field" htmlFor="s-hours">Số giờ
            <input id="s-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} required aria-describedby="s-hours-hint" data-testid="input-session-hours" />
            <span id="s-hours-hint" className="hint">{minutes ? `${minutes} phút` : 'Ví dụ 1,5'}</span>
          </label>
        </div>
        <label className="field" htmlFor="s-member">Kỹ thuật viên
          <select id="s-member" value={memberId} onChange={(e) => setMemberId(e.target.value)} required data-testid="select-session-member">
            <option value="">Chọn nhân viên</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.hourlyRate > 0 ? ` · ${formatVnd(m.hourlyRate)}/giờ` : ' · chưa có lương giờ'}</option>)}
          </select>
          {rateMissing && <span className="hint warn" role="alert">Chưa đặt lương giờ. Mở trang nhân viên để đặt trước khi lưu.</span>}
          {member && !rateMissing && minutes && <span className="hint">Ước tính: {formatVnd((minutes / 60) * effectiveRate)}</span>}
        </label>
        {fixedCardId ? null : (
          <label className="field" htmlFor="s-card">Thẻ liệu trình (không bắt buộc)
            <select id="s-card" value={cardId} onChange={(e) => setCardId(e.target.value)} disabled={cardsLoading} data-testid="select-session-card">
              <option value="">{cardsLoading ? 'Đang tải thẻ…' : 'Khách lẻ, không dùng thẻ'}</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.customerName} · {c.serviceType} · còn {formatMinutes(c.remainingMinutes)}</option>)}
            </select>
          </label>
        )}
        {card ? (
          <p className="hint card-hint" data-testid="text-session-card">Thẻ của <strong>{card.customerName}</strong> · {card.serviceType} · còn {formatMinutes(card.remainingMinutes + ownCardMinutes)}. Khách và dịch vụ lấy theo thẻ.</p>
        ) : (
          <div className="field-row">
            <label className="field" htmlFor="s-service">Dịch vụ
              <input id="s-service" value={serviceType} onChange={(e) => setServiceType(e.target.value)} maxLength={120} required data-testid="input-session-service" />
            </label>
            <label className="field" htmlFor="s-customer">Tên khách (không bắt buộc)
              <input id="s-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={120} data-testid="input-session-customer" />
            </label>
          </div>
        )}
        <label className="field" htmlFor="s-note">Ghi chú
          <textarea id="s-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} data-testid="input-session-note" />
        </label>
        {shown && <p className="form-error" role="alert"><AlertCircle size={13} /> {shown}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy || rateMissing} data-testid="button-save-session">{busy && <LoaderCircle size={14} className="spin" />}Lưu ca</button>
        </div>
      </form>
    </Modal>
  );
}
