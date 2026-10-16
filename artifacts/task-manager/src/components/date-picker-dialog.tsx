import { useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Modal } from '@/components/modal';
import { formatShortDate, localDate } from '@/lib/attendance';
import { daysInMonth, formatMonth, weekday } from '@/lib/massage';

export function DatePickerDialog({ value, title = 'Chọn ngày', immediate = false, onClose, onSelect }: {
  value: string;
  immediate?: boolean;
  title?: string;
  onClose: () => void;
  onSelect: (date: string) => void;
}) {
  const today = localDate();
  const [month, setMonth] = useState(value.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(value);
  const dates = useMemo(() => {
    const days = Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
    return month === today.slice(0, 7) ? [today, ...days.filter((date) => date !== today)] : days;
  }, [month, today]);

  function changeMonth(nextMonth: string) {
    if (!nextMonth) return;
    setMonth(nextMonth);
    setSelectedDate(nextMonth === today.slice(0, 7) ? today : `${nextMonth}-01`);
  }

  return (
    <Modal title={title} description="Ngày theo định dạng ngày/tháng/năm. Hôm nay luôn ở đầu danh sách của tháng hiện tại." onClose={onClose} testId="dialog-date-picker">
      <div className="date-picker-controls">
        <label className="field" htmlFor="date-picker-month">Tháng
          <input id="date-picker-month" type="month" value={month} onChange={(e) => changeMonth(e.target.value)} data-testid="input-date-picker-month" />
        </label>
        <p className="selected-date-preview" role="status"><CalendarDays size={15} aria-hidden="true" />Đang chọn <strong>{formatShortDate(selectedDate)}</strong></p>
      </div>
      <ul className="date-picker-list" aria-label={`Các ngày ${formatMonth(month)}`} data-testid="list-date-picker">
        {dates.map((date) => (
          <li key={date}>
            <button type="button" className={`date-picker-option ${date === selectedDate ? 'selected' : ''}`} aria-pressed={date === selectedDate}
              aria-current={date === today ? 'date' : undefined} onClick={() => { if (immediate) onSelect(date); else setSelectedDate(date); }} data-testid={`button-date-picker-${date}`}>
              <span><strong>{formatShortDate(date)}</strong><span className="muted">{weekday(date)}</span></span>
              <span className="date-picker-badge">{date === today ? 'Hôm nay' : date === selectedDate ? 'Đã chọn' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="dialog-actions date-picker-actions">
        <button type="button" className="btn ghost" onClick={onClose} data-testid="button-cancel-date-picker">Hủy</button>
        {!immediate && <button type="button" className="btn primary" onClick={() => onSelect(selectedDate)} data-testid="button-apply-selected-date">Chọn ngày</button>}
      </div>
    </Modal>
  );
}
