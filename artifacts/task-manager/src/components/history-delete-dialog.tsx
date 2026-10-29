import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getPreviewRetentionDateRangeQueryKey,
  useDeleteRetentionDateRange,
  usePreviewRetentionDateRange,
} from '@workspace/api-client-react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { ErrorBanner, Modal, Skeleton } from '@/components/modal';
import { errorText } from '@/lib/massage';

const count = new Intl.NumberFormat('vi-VN');
const deleteConfirmation = 'XÓA';

function vietnamDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function oneYearBefore(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const previousYear = year - 1;
  const lastDayOfMonth = new Date(Date.UTC(previousYear, month, 0)).getUTCDate();
  return `${previousYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDayOfMonth)).padStart(2, '0')}`;
}

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
  const today = vietnamDate();
  const recentCutoff = oneYearBefore(today);
  const affectsRecentHistory = Boolean(
    validRange && fromDate <= today && toDate >= recentCutoff,
  );
  const confirmed = confirmation.trim() === deleteConfirmation;
  function updateDate(field: 'fromDate' | 'toDate', value: string) {
    if (field === 'fromDate') setFromDate(value);
    else setToDate(value);
    setConfirmation('');
    setCompleted(null);
    removeRange.reset();
  }

  function deleteSelectedRange() {
    if (!validRange || !hasRecords || !confirmed || removeRange.isPending) return;
    removeRange.mutate({ data: range }, {
      onSuccess: async (result) => {
        setCompleted(result);
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
        Chỉ xóa lịch sử cơ sở trong khoảng ngày đã chọn. Sổ cá nhân, nhật ký và số dư thẻ được giữ nguyên; kho phân vùng có thể chưa giảm dung lượng vật lý ngay.
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
              text={errorText(preview.error, 'Không xem trước được lịch sử trong khoảng ngày này.')}
              onRetry={() => void preview.refetch()}
            />
          )}
          {validRange && previewCounts && (
            <div className="banner soft" role="status" data-testid="status-delete-history-range-impact">
              {count.format(previewCounts.attendanceCount)} dòng chấm công · {count.format(previewCounts.serviceSessionCount)} ca dịch vụ · {count.format(previewCounts.cardUseCount)} lượt dùng thẻ sẽ được giữ trong nhật ký.
            </div>
          )}
          {hasRecords && (
            <>
              <div
                className={affectsRecentHistory ? 'form-error' : 'banner soft'}
                role={affectsRecentHistory ? 'alert' : 'note'}
                data-testid="warning-delete-history-impact"
              >
                <strong>{affectsRecentHistory ? 'Cảnh báo: khoảng chọn có dữ liệu trong 12 tháng gần đây.' : 'Ảnh hưởng khi xóa'}</strong>
                <div>Chấm công, ca dịch vụ, doanh thu và tiền công của khoảng này sẽ bị xóa khỏi lịch sử cơ sở.</div>
                <div>Nhật ký dùng thẻ được lưu vĩnh viễn; số giờ không hoàn lại. Nhật ký đã lưu không thể sửa, xóa hoặc hoàn tiền.</div>
              </div>
              <label className="field" htmlFor="delete-history-confirmation">
                Nhập <strong>{deleteConfirmation}</strong> để xóa {fromDate} đến {toDate}
                <input
                  id="delete-history-confirmation"
                  type="text"
                  autoComplete="off"
                  value={confirmation}
                  disabled={removeRange.isPending}
                  onChange={(event) => setConfirmation(event.target.value)}
                  data-testid="input-delete-history-confirmation"
                />
              </label>
            </>
          )}
          {validRange && previewCounts && !hasRecords && (
            <div className="empty small" role="status">Không có lịch sử cơ sở trong khoảng ngày này.</div>
          )}

          {hasRecords && (
            <>
              {removeRange.isError && (
                <p className="form-error" role="alert">
                  {errorText(removeRange.error, 'Không xóa được lịch sử. Dữ liệu chưa được xóa nếu giao dịch bị lỗi.')}
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
              disabled={!validRange || !hasRecords || !confirmed || preview.isLoading || preview.isError || removeRange.isPending}
              data-testid="button-confirm-delete-history"
            >
              {removeRange.isPending ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} aria-hidden="true" />}
              Xóa lịch sử
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
