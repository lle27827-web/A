import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListRetentionYearsQueryKey,
  useDeleteRetentionYear,
  useListRetentionYears,
} from '@workspace/api-client-react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { ErrorBanner, Modal, Skeleton } from '@/components/modal';

const count = new Intl.NumberFormat('vi-VN');

export function HistoryDeleteDialog({ onClose }: { onClose: () => void }) {
  const cache = useQueryClient();
  const years = useListRetentionYears({
    query: { queryKey: getListRetentionYearsQueryKey() },
  });
  const removeYear = useDeleteRetentionYear();
  const [selectedYear, setSelectedYear] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [completed, setCompleted] = useState<{ year: number; deletedAttendance: number; deletedServiceSessions: number; archivedCardUses: number } | null>(null);
  const availableYears = years.data ?? [];
  const selected = availableYears.find((entry) => String(entry.year) === selectedYear);

  useEffect(() => {
    if (!availableYears.length) {
      setSelectedYear('');
      return;
    }
    setSelectedYear((current) =>
      availableYears.some((entry) => String(entry.year) === current)
        ? current
        : String(availableYears[0].year),
    );
  }, [availableYears]);

  function deleteSelectedYear() {
    const year = Number(selectedYear);
    if (!Number.isInteger(year) || confirmation !== selectedYear || removeYear.isPending) return;
    removeYear.mutate({ year }, {
      onSuccess: async (result) => {
        setCompleted(result);
        setConfirmation('');
        await cache.invalidateQueries();
      },
    });
  }

  return (
    <Modal
      title="Xóa lịch sử chấm công"
      onClose={removeYear.isPending ? () => undefined : onClose}
      testId="dialog-delete-attendance-history"
    >
      <p className="muted" role="note">
        Chỉ xóa dữ liệu cơ sở của năm đã chọn. Sổ cá nhân, nhật ký dùng thẻ và số dư thẻ được giữ nguyên.
      </p>

      {completed ? (
        <div className="banner soft" role="status" data-testid="status-history-year-deleted">
          Đã xóa lịch sử cơ sở năm {completed.year}: {count.format(completed.deletedAttendance)} dòng chấm công và {count.format(completed.deletedServiceSessions)} ca dịch vụ. Đã giữ {count.format(completed.archivedCardUses)} lượt dùng thẻ trong nhật ký thẻ.
        </div>
      ) : years.isLoading ? (
        <Skeleton rows={3} label="Đang tải các năm có lịch sử chấm công" />
      ) : years.isError ? (
        <ErrorBanner text="Không tải được danh sách năm." onRetry={() => void years.refetch()} />
      ) : availableYears.length === 0 ? (
        <div className="empty small">Không còn năm nào có lịch sử chấm công cơ sở.</div>
      ) : selected ? (
        <>
          <label className="field" htmlFor="delete-history-year">
            Năm cần xóa
            <select
              id="delete-history-year"
              value={selectedYear}
              disabled={removeYear.isPending}
              onChange={(event) => {
                setSelectedYear(event.target.value);
                setConfirmation('');
                setCompleted(null);
                removeYear.reset();
              }}
              data-testid="select-delete-history-year"
            >
              {availableYears.map((entry) => (
                <option key={entry.year} value={entry.year}>{entry.year}</option>
              ))}
            </select>
          </label>

          <div className="banner soft" role="status" data-testid="status-delete-history-impact">
            {count.format(selected.attendanceCount)} dòng chấm công · {count.format(selected.serviceSessionCount)} ca dịch vụ · {count.format(selected.cardUseCount)} lượt dùng thẻ sẽ được giữ trong nhật ký thẻ.
          </div>

          <label className="field" htmlFor="confirm-delete-history-year">
            Nhập lại năm {selected.year} để xác nhận
            <input
              id="confirm-delete-history-year"
              value={confirmation}
              inputMode="numeric"
              autoComplete="off"
              disabled={removeYear.isPending}
              onChange={(event) => setConfirmation(event.target.value)}
              data-testid="input-confirm-delete-history-year"
            />
          </label>

          {removeYear.isError && <p className="form-error" role="alert">Không xóa được lịch sử. Hãy thử lại.</p>}
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={removeYear.isPending} data-testid="button-cancel-delete-history">Hủy</button>
            <button
              type="button"
              className="btn danger"
              onClick={deleteSelectedYear}
              disabled={confirmation !== selectedYear || removeYear.isPending}
              data-testid="button-confirm-delete-history"
            >
              {removeYear.isPending ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} aria-hidden="true" />}
              Xóa vĩnh viễn
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
