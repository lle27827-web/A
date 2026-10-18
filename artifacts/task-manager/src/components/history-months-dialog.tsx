import { useState } from 'react';
import { getListHistoryMonthsQueryKey, useListHistoryMonths } from '@workspace/api-client-react';
import { CalendarSearch, ChevronRight, History } from 'lucide-react';
import { Modal, ErrorBanner, Skeleton } from '@/components/modal';
import { formatMonth } from '@/lib/massage';
import { monthLastDate, vietnamToday } from '@/lib/revenue-period';

/** Default date inside a month: last day, or today for the current month. */
export function defaultDateFor(month: string, today = vietnamToday()) {
  return month === today.slice(0, 7) ? today : monthLastDate(month);
}

/**
 * Month-list window. `months` overrides the server list (personal notebook supplies its own);
 * otherwise the public facility history list is used.
 */
export function HistoryMonthsDialog({ title = 'Xem lịch sử tháng', description, months, listOnly = false, onPick, onClose }: {
  title?: string;
  description?: string;
  months?: string[];
  listOnly?: boolean;
  onPick: (month: string, date: string) => void;
  onClose: () => void;
}) {
  const today = vietnamToday();
  const currentMonth = today.slice(0, 7);
  const query = useListHistoryMonths({ query: { queryKey: getListHistoryMonthsQueryKey(), enabled: !months } });
  const list = [...new Set(months ?? query.data ?? [])]
    .filter((m) => listOnly ? m < currentMonth : m <= currentMonth)
    .sort()
    .reverse();
  const [month, setMonth] = useState('');
  const [date, setDate] = useState('');
  const maxDate = month ? defaultDateFor(month, today) : '';

  return (
    <Modal title={title} description={listOnly ? undefined : description ?? 'Chọn một tháng có dữ liệu, hoặc nhập bất kỳ tháng nào bên dưới.'} onClose={onClose} testId="dialog-history-months">
      {!listOnly && <form className="history-pick" onSubmit={(e) => { e.preventDefault(); if (month) onPick(month, date && date.slice(0, 7) === month ? date : maxDate); }}>
        <label className="field">Tháng
          <input type="month" value={month} max={currentMonth} onChange={(e) => { setMonth(e.target.value); setDate(''); }} data-testid="input-pick-history-month" />
        </label>
        <label className="field">Ngày (tùy chọn)
          <input type="date" value={date} disabled={!month} min={month ? `${month}-01` : undefined} max={maxDate || undefined} onChange={(e) => setDate(e.target.value)} data-testid="input-pick-history-date" />
        </label>
        <button type="submit" className="btn primary" disabled={!month} data-testid="button-open-history-month"><CalendarSearch size={14} />Mở tháng</button>
      </form>}
      {!listOnly && <h3 className="group-title">Tháng có dữ liệu</h3>}
      {!months && query.isLoading ? <Skeleton rows={4} label="Đang tải danh sách tháng" />
        : !months && query.isError ? <ErrorBanner text="Không tải được danh sách tháng." onRetry={() => void query.refetch()} />
        : list.length === 0 ? <div className="empty small"><History size={18} /><p>{listOnly ? 'Chưa có dữ liệu tháng để xem.' : 'Chưa có tháng nào có dữ liệu. Bạn vẫn có thể nhập tháng ở trên.'}</p></div>
        : (
          <ul className="month-list" data-testid="list-history-months">
            {list.map((m) => (
              <li key={m}>
                <button type="button" className="choice-row" onClick={() => onPick(m, defaultDateFor(m, today))} data-testid={`button-history-month-${m}`}>
                  <History size={15} aria-hidden="true" />
                  <span className="grow"><strong>{formatMonth(m)}</strong>{m === currentMonth && <span className="muted">Tháng hiện tại</span>}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
    </Modal>
  );
}
