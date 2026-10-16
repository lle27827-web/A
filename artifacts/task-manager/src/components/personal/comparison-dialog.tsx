import { useMemo, useState } from 'react';
import { getGetPersonalComparisonQueryKey, getListMembersQueryKey, useGetPersonalComparison, useListMembers } from '@workspace/api-client-react';
import { ArrowLeft, Scale, Users } from 'lucide-react';
import { Modal, ErrorBanner, Skeleton } from '@/components/modal';
import { formatShortDate } from '@/lib/attendance';
import { formatMonth, formatVnd } from '@/lib/massage';

function Diff({ value, testId }: { value: number; testId: string }) {
  const cls = value > 0 ? 'pos' : value < 0 ? 'neg' : '';
  return <strong className={`mono diff ${cls}`} data-testid={testId}>{value > 0 ? '+' : ''}{formatVnd(value)}</strong>;
}

export function ComparisonDialog({ month, date, onClose }: { month: string; date: string; onClose: () => void }) {
  const [memberId, setMemberId] = useState<number | null>(null);
  const memberParams = useMemo(() => ({ month }), [month]);
  const members = useListMembers(memberParams, { query: { queryKey: getListMembersQueryKey(memberParams), staleTime: 30_000, refetchOnWindowFocus: true } });
  const params = useMemo(() => ({ memberId: memberId ?? 0, month, date }), [memberId, month, date]);
  const cmp = useGetPersonalComparison(params, { query: { queryKey: getGetPersonalComparisonQueryKey(params), enabled: memberId !== null, staleTime: 15_000, refetchOnMount: true, refetchOnWindowFocus: true, refetchInterval: 60_000 } });

  return (
    <Modal title="Đối chiếu tiền công" description={`So sánh tổng tiền công trong sổ của bạn với một nhân viên cơ sở · ${formatMonth(month)}, ngày ${formatShortDate(date)}. Chỉ xem tổng, không đồng bộ dữ liệu.`} onClose={onClose} testId="dialog-comparison">
      {memberId === null ? (
        members.isLoading ? <Skeleton rows={5} label="Đang tải danh sách nhân viên" />
          : members.isError ? <ErrorBanner text="Không tải được danh sách nhân viên cơ sở." onRetry={() => void members.refetch()} />
          : (members.data ?? []).length === 0 ? <div className="empty small" data-testid="status-compare-empty"><Users size={18} /><p>Cơ sở không có nhân viên nào trong {formatMonth(month).toLowerCase()}.</p></div>
          : (
            <ul className="month-list" data-testid="list-compare-members">
              {(members.data ?? []).map((m) => (
                <li key={m.id}><button type="button" className="choice-row" onClick={() => setMemberId(m.id)} data-testid={`button-compare-member-${m.id}`}>
                  <span className="initials">{m.name.slice(0, 1).toUpperCase()}</span><strong className="grow">{m.name}</strong><Scale size={15} aria-hidden="true" />
                </button></li>
              ))}
            </ul>
          )
      ) : (
        <div className="compare">
          <button type="button" className="back as-button" onClick={() => setMemberId(null)} data-testid="button-compare-change"><ArrowLeft size={14} />Chọn nhân viên khác</button>
          {cmp.isLoading ? <Skeleton rows={4} label="Đang đối chiếu" />
            : cmp.isError ? <ErrorBanner text="Không đối chiếu được. Hãy thử lại." onRetry={() => void cmp.refetch()} />
            : cmp.data && (
              <table className="data-table compare-table" data-testid="table-comparison">
                <thead><tr><th scope="col"></th><th scope="col">Ngày {formatShortDate(date)}</th><th scope="col">{formatMonth(month)}</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Sổ của tôi</th><td className="mono" data-testid="text-cmp-personal-day">{formatVnd(cmp.data.personalDay)}</td><td className="mono" data-testid="text-cmp-personal-month">{formatVnd(cmp.data.personalMonth)}</td></tr>
                  <tr><th scope="row">Cơ sở · {cmp.data.memberName}</th><td className="mono" data-testid="text-cmp-ref-day">{formatVnd(cmp.data.referenceDay)}</td><td className="mono" data-testid="text-cmp-ref-month">{formatVnd(cmp.data.referenceMonth)}</td></tr>
                  <tr className="diff-row"><th scope="row">Chênh lệch</th><td><Diff value={cmp.data.differenceDay} testId="text-cmp-diff-day" /></td><td><Diff value={cmp.data.differenceMonth} testId="text-cmp-diff-month" /></td></tr>
                </tbody>
              </table>
            )}
          <p className="hint" data-testid="text-cmp-explainer">Chênh lệch = sổ của tôi − cơ sở. Số dương: sổ của bạn ghi nhiều hơn.</p>
        </div>
      )}
    </Modal>
  );
}
