import { useState, type FormEvent } from 'react';
import type { MemberRecord, TreatmentCard, TreatmentCardInput } from '@workspace/api-client-react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { Modal } from '@/components/modal';
import { formatMinutes, formatVnd, hoursValue, parseHoursToMinutes, parseMoney } from '@/lib/massage';

export function CardDialog({ card, defaultDate, busy, serverError, onClose, onSubmit }: {
  card: TreatmentCard | null; defaultDate: string; busy: boolean; serverError: string;
  onClose: () => void; onSubmit: (input: TreatmentCardInput) => void;
}) {
  const [customerName, setCustomerName] = useState(card?.customerName ?? '');
  const [phone, setPhone] = useState(card?.phone ?? '');
  const [serviceType, setServiceType] = useState(card?.serviceType ?? '');
  const [hours, setHours] = useState(card ? hoursValue(card.totalMinutes) : '10');
  const [amount, setAmount] = useState(card ? String(card.purchaseAmount) : '');
  const [purchaseDate, setPurchaseDate] = useState(card?.purchaseDate ?? defaultDate);
  const [note, setNote] = useState(card?.note ?? '');
  const [error, setError] = useState('');
  const totalMinutes = parseHoursToMinutes(hours);
  const money = parseMoney(amount);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!customerName.trim()) return setError('Hãy nhập tên khách.');
    if (!phone.trim()) return setError('Hãy nhập số điện thoại.');
    if (!serviceType.trim()) return setError('Hãy nhập loại dịch vụ.');
    if (!totalMinutes) return setError('Tổng số giờ phải lớn hơn 0.');
    if (card && totalMinutes < card.usedMinutes) return setError(`Tổng giờ không được nhỏ hơn số đã dùng (${formatMinutes(card.usedMinutes)}).`);
    if (money === null) return setError('Hãy nhập số tiền đã trả.');
    if (!purchaseDate) return setError('Hãy chọn ngày mua.');
    setError('');
    onSubmit({ customerName: customerName.trim(), phone: phone.trim(), serviceType: serviceType.trim(), totalMinutes, purchaseAmount: money, purchaseDate, note: note.trim() });
  }
  const shown = error || serverError;
  return (
    <Modal title={card ? 'Sửa thẻ liệu trình' : 'Bán thẻ liệu trình mới'} description="Doanh thu tính theo tiền bán thẻ, vào ngày mua." onClose={onClose} testId="dialog-card">
      <form className="form-grid" onSubmit={submit} noValidate>
        <div className="field-row">
          <label className="field" htmlFor="c-name">Tên khách<input id="c-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={120} required data-testid="input-card-customer" /></label>
          <label className="field" htmlFor="c-phone">Số điện thoại<input id="c-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} required data-testid="input-card-phone" /></label>
        </div>
        <label className="field" htmlFor="c-service">Loại dịch vụ<input id="c-service" value={serviceType} onChange={(e) => setServiceType(e.target.value)} maxLength={120} required placeholder="Massage body đá nóng" data-testid="input-card-service" /></label>
        <div className="field-row">
          <label className="field" htmlFor="c-hours">Tổng số giờ đã mua
            <input id="c-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} required data-testid="input-card-hours" />
            <span className="hint">{totalMinutes ? `${totalMinutes} phút` : 'Ví dụ 10'}</span>
          </label>
          <label className="field" htmlFor="c-amount">Tiền đã trả (VND)
            <input id="c-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} required data-testid="input-card-amount" />
            <span className="hint">{money !== null ? formatVnd(money) : ' '}</span>
          </label>
        </div>
        <label className="field" htmlFor="c-date">Ngày mua<input id="c-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required data-testid="input-card-date" /></label>
        <label className="field" htmlFor="c-note">Ghi chú<textarea id="c-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} data-testid="input-card-note" /></label>
        {shown && <p className="form-error" role="alert"><AlertCircle size={13} /> {shown}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy} data-testid="button-save-card">{busy && <LoaderCircle size={14} className="spin" />}Lưu thẻ</button>
        </div>
      </form>
    </Modal>
  );
}

export function MemberDialog({ member, busy, serverError, onClose, onSubmit }: {
  member: MemberRecord | null; busy: boolean; serverError: string;
  onClose: () => void; onSubmit: (input: { name: string }) => void;
}) {
  const [name, setName] = useState(member?.name ?? '');
  const [error, setError] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Hãy nhập tên nhân viên.');
    setError('');
    onSubmit({ name: name.trim() });
  }
  const shown = error || serverError;
  return (
    <Modal title={member ? 'Sửa nhân viên' : 'Thêm nhân viên'} description="Lương tính theo giá trả công của từng dịch vụ, không theo nhân viên." onClose={onClose} testId="dialog-member">
      <form className="form-grid" onSubmit={submit} noValidate>
        <label className="field" htmlFor="m-name">Tên nhân viên<input id="m-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required data-testid="input-member-name" /></label>
        {shown && <p className="form-error" role="alert"><AlertCircle size={13} /> {shown}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy} data-testid="button-save-member">{busy && <LoaderCircle size={14} className="spin" />}Lưu</button>
        </div>
      </form>
    </Modal>
  );
}
