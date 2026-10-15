import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getListServiceTypesQueryKey, useListServiceTypes } from '@workspace/api-client-react';
import type { MemberRecord, ServiceSession, ServiceSessionInput, TreatmentCard } from '@workspace/api-client-react';
import { AlertCircle, CalendarDays, LoaderCircle } from 'lucide-react';
import { Link } from 'wouter';
import { Modal } from '@/components/modal';
import { DatePickerDialog } from '@/components/date-picker-dialog';
import { formatShortDate, normalize } from '@/lib/attendance';
import { formatMinutes, formatVnd, hoursValue, parseHoursToMinutes } from '@/lib/massage';

const KEEP = 'keep';

export function SessionDialog({ session, members, cards, cardsLoading, defaultDate, defaultMemberId, fixedMemberId, fixedCardId, busy, serverError, onClose, onSubmit }: {
  session: ServiceSession | null;
  members: MemberRecord[];
  cards: TreatmentCard[];
  cardsLoading?: boolean;
  defaultDate: string;
  defaultMemberId?: number | null;
  fixedMemberId?: number | null;
  fixedCardId?: number | null;
  busy: boolean;
  serverError: string;
  onClose: () => void;
  onSubmit: (input: ServiceSessionInput) => void;
}) {
  const catalogQuery = useListServiceTypes({ query: { queryKey: getListServiceTypesQueryKey(), staleTime: 20_000, refetchInterval: 60_000, refetchOnWindowFocus: true } });
  const catalog = catalogQuery.data ?? [];
  const [memberId, setMemberId] = useState(String(session?.memberId ?? fixedMemberId ?? defaultMemberId ?? ''));
  const [cardId, setCardId] = useState(String(session ? session.cardId ?? '' : fixedCardId ?? ''));
  const [date, setDate] = useState(session?.workDate ?? defaultDate);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [hours, setHours] = useState(session ? hoursValue(session.minutes) : '1');
  const [serviceId, setServiceId] = useState(session ? (session.serviceTypeId !== null ? String(session.serviceTypeId) : KEEP) : '');
  const [customerName, setCustomerName] = useState(session && session.cardId === null ? session.customerName : '');
  const [note, setNote] = useState(session?.note ?? '');
  const [error, setError] = useState('');
  const autoPickedFor = useRef<string | null>(null);

  const member = members.find((m) => String(m.id) === memberId) ?? null;
  const fixedMember = fixedMemberId ? members.find((m) => m.id === fixedMemberId) ?? null : null;
  const card = cards.find((c) => String(c.id) === cardId) ?? null;
  const minutes = parseHoursToMinutes(hours);
  const ownCardMinutes = session && session.cardId !== null && String(session.cardId) === cardId ? session.minutes : 0;
  const selected = catalog.find((s) => String(s.id) === serviceId) ?? null;
  const keepsSnapshot = !!session && (serviceId === KEEP || (session.serviceTypeId !== null && String(session.serviceTypeId) === serviceId));
  const rate = keepsSnapshot ? session!.hourlyRate : selected?.hourlyRate ?? 0;
  const customerRate = keepsSnapshot ? session!.customerHourlyRate : selected?.customerHourlyRate ?? 0;
  const orphanId = session && session.serviceTypeId !== null && !catalog.some((s) => s.id === session.serviceTypeId) ? session.serviceTypeId : null;

  // Preselect catalog service only when the card label exactly matches a catalog name (new sessions only).
  useEffect(() => {
    if (session || !card || catalog.length === 0 || autoPickedFor.current === String(card.id)) return;
    autoPickedFor.current = String(card.id);
    const match = catalog.find((s) => normalize(s.name) === normalize(card.serviceType));
    if (match) setServiceId((cur) => cur || String(match.id));
  }, [session, card, catalog]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!member) return setError('Hãy chọn kỹ thuật viên.');
    if (!serviceId) return setError('Hãy chọn dịch vụ.');
    if (serviceId !== KEEP && !selected && !(orphanId !== null && serviceId === String(orphanId))) return setError('Dịch vụ đã chọn không còn trong danh mục. Hãy chọn dịch vụ khác.');
    if (serviceId === KEEP && !session) return setError('Ca mới phải chọn dịch vụ trong danh mục.');
    if (!date) return setError('Hãy chọn ngày.');
    if (minutes === null || minutes < 1 || minutes > 1440) return setError('Số giờ phải lớn hơn 0 và không quá 24 giờ.');
    if (!cardId && customerRate <= 0 && !keepsSnapshot) return setError('Hãy cài giá khách trả cho dịch vụ trước khi ghi ca khách lẻ.');
    setError('');
    const input: ServiceSessionInput = { memberId: member.id, workDate: date, minutes, note: note.trim(), serviceTypeId: serviceId === KEEP ? null : Number(serviceId) };
    if (cardId) input.cardId = Number(cardId);
    else { input.cardId = null; input.customerName = customerName.trim(); }
    onSubmit(input);
  }

  const shown = error || serverError;
  const quick = !!fixedMemberId && !session;
  return (
    <Modal title={session ? 'Sửa ca phục vụ' : quick ? `Chấm công${fixedMember ? ` · ${fixedMember.name}` : ''}` : 'Thêm ca phục vụ'}
      description="Chọn dịch vụ và số giờ. Tiền công tính theo mức của nhân viên; doanh thu khách lẻ tính theo giá khách trả. Ca dùng thẻ không ghi doanh thu lần nữa." onClose={onClose} testId="dialog-session">
      <form className="form-grid" onSubmit={submit} noValidate>
        <fieldset className="field service-pick">
          <legend>Dịch vụ</legend>
          {catalogQuery.isLoading ? <span className="hint" role="status">Đang tải danh mục dịch vụ…</span>
            : catalogQuery.isError ? <span className="hint warn" role="alert">Không tải được danh mục. <button type="button" className="link-soft as-button" onClick={() => void catalogQuery.refetch()}>Thử lại</button></span>
            : catalog.length === 0 && !session ? <span className="hint warn" role="alert">Chưa có dịch vụ nào. <Link href="/services" className="link-soft">Thêm dịch vụ</Link> trước khi chấm công.</span>
            : (
              <div className="service-options" role="radiogroup" aria-label="Chọn dịch vụ">
                {session && session.serviceTypeId === null && (
                  <label className={`service-option ${serviceId === KEEP ? 'on' : ''}`}>
                    <input type="radio" name="s-service" value={KEEP} checked={serviceId === KEEP} onChange={() => setServiceId(KEEP)} data-testid="radio-service-keep" />
                    <span><strong>Giữ dịch vụ cũ: {session.serviceType || 'không tên'}</strong><span className="muted mono">{session.customerHourlyRate > 0 ? `Khách ${formatVnd(session.customerHourlyRate)}/giờ · ` : 'Chưa lưu giá khách · '}Lương ${formatVnd(session.hourlyRate)}/giờ · mức đã lưu</span></span>
                  </label>
                )}
                {orphanId !== null && session && (
                  <label className={`service-option ${serviceId === String(orphanId) ? 'on' : ''}`}>
                    <input type="radio" name="s-service" value={orphanId} checked={serviceId === String(orphanId)} onChange={() => setServiceId(String(orphanId))} />
                    <span><strong>{session.serviceType}</strong><span className="muted mono">{session.customerHourlyRate > 0 ? `Khách ${formatVnd(session.customerHourlyRate)}/giờ · ` : 'Chưa lưu giá khách · '}Lương ${formatVnd(session.hourlyRate)}/giờ · mức đã lưu</span></span>
                  </label>
                )}
                {catalog.map((s) => {
                  const same = session?.serviceTypeId === s.id;
                  const shownCustomerRate = same ? session!.customerHourlyRate : s.customerHourlyRate;
                  const shownEmployeeRate = same ? session!.hourlyRate : s.hourlyRate;
                  return (
                    <label key={s.id} className={`service-option ${serviceId === String(s.id) ? 'on' : ''}`}>
                      <input type="radio" name="s-service" value={s.id} checked={serviceId === String(s.id)} onChange={() => setServiceId(String(s.id))} data-testid={`radio-service-${s.id}`} />
                      <span><strong>{same ? session!.serviceType : s.name}</strong><span className="muted mono">{shownCustomerRate > 0 ? `Khách ${formatVnd(shownCustomerRate)}/giờ · ` : 'Chưa cài giá khách · '}Lương {formatVnd(shownEmployeeRate)}/giờ{same ? ' · mức đã lưu' : ''}</span></span>
                    </label>
                  );
                })}
              </div>
            )}
        </fieldset>
        <div className="field-row session-hours-row">
          <label className="field" htmlFor="s-hours">Số giờ
            <input id="s-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} required aria-describedby="s-hours-hint" data-testid="input-session-hours" />
            <span id="s-hours-hint" className="hint">{minutes
              ? `${minutes} phút · Lương ${formatVnd(Math.round(minutes * rate / 60))}${cardId ? ' · doanh thu thẻ đã tính khi bán' : customerRate > 0 ? ` · Khách trả ${formatVnd(Math.round(minutes * customerRate / 60))}` : ' · chưa cài giá khách'}`
              : 'Ví dụ 1,5'}</span>
          </label>
        </div>
        <div className="field session-date-control">
          <span>Ngày chấm công</span>
          <button type="button" className="btn date-picker-trigger" onClick={() => setDatePickerOpen(true)} aria-label={`Chọn ngày chấm công, hiện tại ${formatShortDate(date)}`} data-testid="button-open-session-date-picker">
            <CalendarDays size={15} aria-hidden="true" />{formatShortDate(date)}
          </button>
          <input type="hidden" name="workDate" value={date} required />
        </div>
        {fixedMemberId && !session ? (
          <p className="hint" data-testid="text-session-member">Kỹ thuật viên: <strong>{fixedMember?.name ?? `#${fixedMemberId}`}</strong></p>
        ) : (
          <label className="field" htmlFor="s-member">Kỹ thuật viên
            <select id="s-member" value={memberId} onChange={(e) => setMemberId(e.target.value)} required data-testid="select-session-member">
              <option value="">Chọn nhân viên</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        <details className="extras" open={!!session || !!fixedCardId || undefined}>
          <summary>Thêm khách, thẻ, ghi chú (không bắt buộc)</summary>
          <div className="form-grid">
            {fixedCardId ? null : (
              <label className="field" htmlFor="s-card">Thẻ liệu trình
                <select id="s-card" value={cardId} onChange={(e) => setCardId(e.target.value)} disabled={cardsLoading} data-testid="select-session-card">
                  <option value="">{cardsLoading ? 'Đang tải thẻ…' : 'Khách lẻ, không dùng thẻ'}</option>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.customerName} · {c.serviceType} · còn {formatMinutes(c.remainingMinutes)}</option>)}
                </select>
              </label>
            )}
            {card ? (
              <p className="hint card-hint" data-testid="text-session-card">Thẻ của <strong>{card.customerName}</strong> · {card.serviceType} · còn {formatMinutes(card.remainingMinutes + ownCardMinutes)}. Khách và số dư lấy theo thẻ.</p>
            ) : (
              <label className="field" htmlFor="s-customer">Tên khách
                <input id="s-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={120} data-testid="input-session-customer" />
              </label>
            )}
            <label className="field" htmlFor="s-note">Ghi chú
              <textarea id="s-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} data-testid="input-session-note" />
            </label>
          </div>
        </details>
        {shown && <p className="form-error" role="alert"><AlertCircle size={13} /> {shown}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy || catalogQuery.isLoading} data-testid="button-save-session">{busy && <LoaderCircle size={14} className="spin" />}Lưu ca</button>
        </div>
      </form>
      {datePickerOpen && <DatePickerDialog value={date} title="Chọn ngày chấm công" onClose={() => setDatePickerOpen(false)}
        onSelect={(nextDate) => { setDate(nextDate); setDatePickerOpen(false); }} />}
    </Modal>
  );
}
