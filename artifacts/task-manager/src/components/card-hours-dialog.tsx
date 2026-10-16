import { useState, type FormEvent } from 'react';
import type { CardHoursInput, TreatmentCard } from '@workspace/api-client-react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { Modal } from '@/components/modal';
import { formatMinutes, formatVnd, parseHoursToMinutes, parseMoney } from '@/lib/massage';

export function CardHoursDialog({ card, busy, serverError, onClose, onSubmit }: {
  card: TreatmentCard; busy: boolean; serverError: string;
  onClose: () => void; onSubmit: (input: CardHoursInput) => void;
}) {
  const [hours, setHours] = useState('1');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const minutes = parseHoursToMinutes(hours);
  const money = parseMoney(amount);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!minutes || minutes > 600000) return setError('Số giờ nạp phải lớn hơn 0 và không quá 10.000 giờ.');
    if (card.totalMinutes + minutes > 600000) return setError('Tổng số giờ của thẻ không được vượt quá 10.000 giờ.');
    if (!amount.trim() || money === null || money < 0 || money > 1000000000) return setError('Nhập số tiền nạp từ 0 đến 1 tỷ đồng.');
    setError('');
    onSubmit({ minutes, amount: money });
  }
  const shown = error || serverError;
  return (
    <Modal title="Nạp thẻ" onClose={onClose} testId="dialog-card-hours">
      <form className="form-grid" onSubmit={submit} noValidate>
        <p className="hint">Thẻ của <strong>{card.customerName}</strong> · còn {formatMinutes(card.remainingMinutes)}</p>
        <label className="field" htmlFor="card-add-hours">Số giờ nạp thêm
          <input id="card-add-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} required aria-describedby="card-hours-preview" data-testid="input-card-add-hours" />
          <span id="card-hours-preview" className="hint" role="status">{minutes ? `Nạp ${formatMinutes(minutes)} · số dư dự kiến ${formatMinutes(card.remainingMinutes + minutes)}` : ' '}</span>
        </label>
        <label className="field" htmlFor="card-add-amount">Số tiền nạp (VND)
          <input id="card-add-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
            required data-testid="input-card-add-amount" />
          {money !== null && amount.trim() && <span className="hint">{formatVnd(money)}</span>}
        </label>
        {shown && <p className="form-error" role="alert"><AlertCircle size={13} />{shown}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy} data-testid="button-save-card-hours">{busy && <LoaderCircle size={14} className="spin" />}Nạp thẻ</button>
        </div>
      </form>
    </Modal>
  );
}
