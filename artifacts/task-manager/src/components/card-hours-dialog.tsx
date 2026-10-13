import { useState, type FormEvent } from 'react';
import type { TreatmentCard } from '@workspace/api-client-react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { Modal } from '@/components/modal';
import { formatMinutes, parseHoursToMinutes } from '@/lib/massage';

export function CardHoursDialog({ card, busy, serverError, onClose, onSubmit }: {
  card: TreatmentCard; busy: boolean; serverError: string;
  onClose: () => void; onSubmit: (minutes: number) => void;
}) {
  const [hours, setHours] = useState('1');
  const [error, setError] = useState('');
  const minutes = parseHoursToMinutes(hours);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!minutes || minutes > 600000) return setError('Số giờ nạp phải lớn hơn 0 và không quá 10.000 giờ.');
    if (card.totalMinutes + minutes > 600000) return setError('Tổng số giờ của thẻ không được vượt quá 10.000 giờ.');
    setError('');
    onSubmit(minutes);
  }
  const shown = error || serverError;
  return (
    <Modal title="Nạp thêm giờ vào thẻ" description="Chỉ cộng giờ. Tiền bán thẻ và lương không đổi." onClose={onClose} testId="dialog-card-hours">
      <form className="form-grid" onSubmit={submit} noValidate>
        <p className="hint">Thẻ của <strong>{card.customerName}</strong> · còn {formatMinutes(card.remainingMinutes)}</p>
        <label className="field" htmlFor="card-add-hours">Số giờ nạp thêm
          <input id="card-add-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} required aria-describedby="card-hours-preview" data-testid="input-card-add-hours" />
          <span id="card-hours-preview" className="hint" role="status">{minutes ? `Nạp ${formatMinutes(minutes)} · số dư dự kiến ${formatMinutes(card.remainingMinutes + minutes)}` : ' '}</span>
        </label>
        {shown && <p className="form-error" role="alert"><AlertCircle size={13} />{shown}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy} data-testid="button-save-card-hours">{busy && <LoaderCircle size={14} className="spin" />}Nạp giờ</button>
        </div>
      </form>
    </Modal>
  );
}
