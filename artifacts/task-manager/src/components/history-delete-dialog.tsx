import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getPreviewRetentionDateRangeQueryKey,
  useDeleteRetentionDateRange,
  usePreviewRetentionDateRange,
} from '@workspace/api-client-react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { ErrorBanner, Modal, Skeleton } from '@/components/modal';

const count = new Intl.NumberFormat('vi-VN');
const CONFIRMATION = 'XÓA';

type DeleteResult = {
  fromDate: string;
  toDate: string;
  deletedAttendance: number;
  deletedServiceSessions: number;
  archivedCardUses: number;
};

export function HistoryDeleteDialog({ onClose }: { onClose: () => void }) {
  const cache = useQueryClient();
  const removeRange = useDeleteRetentionDateRange();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [completed, setCompleted] = useState<DeleteResult | null>(null);
  const range = { fromDate, toDate };
  const validRange = Boolean(fromDate && toDate && fromDate <= toDate);
  const preview = usePreviewRetentionDateRange(range, {
    query: {
      enabled: validRange && !completed,
      queryKey: getPreviewRetentionDateRangeQueryKey(range),
    },
  });
  const previewCounts = preview.data;
  const hasRecords = Boolean(
    previewCounts &&
    (previewCounts.attendanceCount > 0 || previewCounts.serviceSessionCount > 0),
  );
  const confirming = confirmation.trim().toLocaleUpperCase('vi-VN') === CONFIRMATION;

  function updateDate(field: 'fromDate' | 'toDate', value: string) {
    if (field === 'fromDate') setFromDate(value);
    else setToDate(value);
    setConfirmation('');
    setCompleted(null);
    removeRange.reset();
  }

  function deleteSelectedRange() {
    if (!validRange || !hasRecords || !confirming || removeRange.isPending) return;
    removeRange.mutate({ data: range }, {
      onSuccess: async (result) => {
        setCompleted(result);
        setConfirmation('');
        await Promise.all([
          cache.invalidateQueries({ queryKey: getPreviewRetentionDateRangeQueryKey(range) }),
          cache.invalidateQueries({
            predicate: ({ queryKey }) => {
              const path = String(queryKey[0] ?? '');
              return [
                '/api/attendance',
                '/api/service-sessions',
                '/api/massage-summary',
                '/api/member-payroll',
                '/api/history-months',
                '/api/retention/',
                '/api/card-usage-history',
                '/api/treatment-cards',
              ].some((prefix) => path.startsWith(prefix));
            },
          }),
        ]);
      },
    });
  }

  return (
    <Modal
      title="Xóa lịch sử chấm công"
      onClose={removeRange.isPending ? () => undefined : onClose}
      testId="dialog-delete-attendance-history"
    >
      <p className="muted" role="note">
        Chỉ xóa lịch sử cơ sở trong khoảng ngày đã chọn. Sổ cá nhân, nhật ký và số dư thẻ được giữ nguyên.
      </p>

      {completed ? (
        <div className="banner soft" role="status" data-testid="status-history-range-deleted">
          Đã xóa từ {completed.fromDate} đến {completed.toDate}: {count.format(completed.deletedAttendance)} dòng chấm công và {count.format(completed.deletedServiceSessions)} ca dịch vụ. Đã lưu {count.format(completed.archivedCardUses)} lượt dùng thẻ vào nhật ký.
        </div>
      ) : (
        <>
          <div className="form-grid">
            <label className="field" htmlFor="delete-history-from-date">
              Từ ngày
              <input
                id="delete-history-from-date"
                type="date"
                value={fromDate}
                disabled={removeRange.isPending}
                onChange={(event) => updateDate('fromDate', event.target.value)}
                data-testid="input-delete-history-from-date"
              />
            </label>
            <label className="field" htmlFor="delete-history-to-date">
              Đến ngày
              <input
                id="delete-history-to-date"
                type="date"
                value={toDate}
                disabled={removeRange.isPending}
                onChange={(event) => updateDate('toDate', event.target.value)}
                data-testid="input-delete-history-to-date"
              />
            </label>
          </div>

          {fromDate && toDate && fromDate > toDate && (
            <p className="form-error" role="alert">Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.</p>
          )}

          {validRange && preview.isLoading && (
            <Skeleton rows={2} label="Đang đếm dữ liệu trong khoảng ngày đã chọn" />
          )}
          {validRange && preview.isError && (
            <ErrorBanner
              text="Không xem trước được. Nếu kho phân vùng đang bật, thao tác xóa tạm khóa để tránh tăng dung lượng nhật ký."
              onRetry={() => void preview.refetch()}
            />
          )}
          {validRange && previewCounts && (
            <div className="banner soft" role="status" data-testid="status-delete-history-range-impact">
              {count.format(previewCounts.attendanceCount)} dòng chấm công · {count.format(previewCounts.serviceSessionCount)} ca dịch vụ · {count.format(previewCounts.cardUseCount)} lượt dùng thẻ sẽ được giữ trong nhật ký.
            </div>
          )}
          {validRange && previewCounts && !hasRecords && (
            <div className="empty small" role="status">Không có lịch sử cơ sở trong khoảng ngày này.</div>
          )}

          {hasRecords && (
            <>
              <label className="field" htmlFor="confirm-delete-history-range">
                Nhập “XÓA” để xác nhận
                <input
                  id="confirm-delete-history-range"
                  value={confirmation}
                  autoComplete="off"
                  disabled={removeRange.isPending}
                  onChange={(event) => setConfirmation(event.target.value)}
                  data-testid="input-confirm-delete-history-range"
                />
              </label>

              {removeRange.isError && (
                <p className="form-error" role="alert">
                  Không xóa được lịch sử. Dữ liệu chưa được xóa nếu giao dịch bị lỗi.
                </p>
              )}
            </>
          )}

          <div className="dialog-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              disabled={removeRange.isPending}
              data-testid="button-cancel-delete-history"
            >
              Hủy
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={deleteSelectedRange}
              disabled={!validRange || !hasRecords || !confirming || removeRange.isPending}
              data-testid="button-confirm-delete-history"
            >
              {removeRange.isPending ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} aria-hidden="true" />}
              Xóa vĩnh viễn
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
