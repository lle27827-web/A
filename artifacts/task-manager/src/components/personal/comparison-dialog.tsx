import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPersonalComparisonQueryKey, getGetPersonalNotebookQueryKey, getListMembersQueryKey,
  useGetPersonalComparison, useListMembers, useSyncPersonalNotebook,
} from '@workspace/api-client-react';
import type { PersonalComparisonVisit } from '@workspace/api-client-react';
import { AlertCircle, AlertTriangle, ArrowLeft, Check, CheckCircle2, LoaderCircle, RefreshCw, Scale, Users } from 'lucide-react';
import { Modal, ErrorBanner, Skeleton } from '@/components/modal';
import { formatShortDate, localDate } from '@/lib/attendance';
import { errorText, formatMinutes, formatMonth } from '@/lib/massage';
import { compareServiceHours, comparisonMemberParams, comparisonResult, comparisonRoster } from '@/lib/comparison-display';

type Scope = 'day' | 'month';

function CompactDifference({ serviceName, personalMinutes, referenceMinutes, index }: { serviceName: string; personalMinutes: number; referenceMinutes: number; index: number }) {
  const formatServiceHours = (minutes: number) => minutes === 0 ? '0 giờ' : formatMinutes(minutes);
  return (
    <div className="cmp-disc" data-testid={`row-cmp-discrepancy-${index}`}>
      <strong className="cmp-pair-title">Dịch vụ chưa khớp {index + 1}</strong>
      <h4>{serviceName}</h4>
      <div className="cmp-cols">
        {[{ title: 'Cơ sở', minutes: referenceMinutes }, { title: 'Cá nhân', minutes: personalMinutes }].map(({ title, minutes }) => (
          <div className="cmp-shift" key={title}>
            <strong>{title}</strong>
            <span>{formatServiceHours(minutes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const isConflict = (e: unknown) => !!e && typeof e === 'object' && (e as { status?: unknown }).status === 409;

export function ComparisonDialog({ month, date, onClose, onUpdated }: { month: string; date: string; onClose: () => void; onUpdated?: () => void }) {
  const cache = useQueryClient();
  const [memberId, setMemberId] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>('day');
  const [confirming, setConfirming] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [notice, setNotice] = useState('');
  const syncing = useRef(false);
  // Match the facility's main roster: current active employees today, historical
  // identities only when explicitly looking at an older month.
  const memberParams = useMemo(() => comparisonMemberParams(month, localDate().slice(0, 7)), [month]);
  const members = useListMembers(memberParams, { query: { queryKey: getListMembersQueryKey(memberParams), staleTime: 30_000, refetchOnWindowFocus: true } });
  const roster = useMemo(() => comparisonRoster(members.data ?? []), [members.data]);
  const selectedMember = roster.find((m) => m.id === memberId);
  useEffect(() => {
    if (members.isSuccess && memberId !== null && !selectedMember) {
      setMemberId(null); setConfirming(false);
    }
  }, [members.isSuccess, memberId, selectedMember]);
  const params = useMemo(() => ({ memberId: memberId ?? 0, month, date }), [memberId, month, date]);
  const cmp = useGetPersonalComparison(params, { query: {
    queryKey: getGetPersonalComparisonQueryKey(params),
    enabled: !!selectedMember,
    staleTime: 0,
    // Always fetch a fresh snapshot when the dialog/employee query is opened,
    // even if React Query still has a cached comparison for these parameters.
    refetchOnMount: 'always',
    refetchOnWindowFocus: confirming ? false : 'always',
    refetchOnReconnect: 'always',
  } });
  const sync = useSyncPersonalNotebook();

  const d = cmp.data;
  const inScope = (v: PersonalComparisonVisit) => scope === 'month' || v.workDate === date;
  const personal = (d?.personalVisits ?? []).filter(inScope);
  const reference = (d?.referenceVisits ?? []).filter(inScope);
  const serviceDifferences = compareServiceHours(personal, reference);
  const result = comparisonResult(personal.length, reference.length, serviceDifferences.length);
  const rangeLabel = scope === 'day' ? `ngày ${formatShortDate(date)}` : formatMonth(month).toLowerCase();
  function pick(id: number | null) { setMemberId(id); setConfirming(false); setSyncError(''); setNotice(''); }
  function runSync() {
    if (!d || !selectedMember || memberId === null || syncing.current || sync.isPending) return;
    syncing.current = true;
    setSyncError('');
    sync.mutate({ data: { memberId, month, date, scope, revision: scope === 'day' ? d.revisionDay : d.revisionMonth } }, {
      onSuccess: (r) => {
        syncing.current = false;
        setConfirming(false);
        setNotice(`Đã cập nhật ${rangeLabel}: xóa ${r.removed} ca trong sổ, nhập ${r.imported} ca từ cơ sở.`);
        void cache.invalidateQueries({ queryKey: getGetPersonalNotebookQueryKey() });
        void cache.invalidateQueries({ queryKey: getGetPersonalComparisonQueryKey() });
        onUpdated?.();
      },
      onError: (e) => {
        syncing.current = false;
        setConfirming(false);
        if (isConflict(e)) {
          setSyncError('Dữ liệu đã thay đổi kể từ lúc bạn xem. Đã tải lại đối chiếu — hãy xem lại rồi xác nhận lần nữa.');
          void cmp.refetch();
        } else setSyncError(errorText(e));
      },
    });
  }

  return (
    <Modal title="Đối chiếu tiền công" onClose={onClose} testId="dialog-comparison">
      {memberId === null ? (
        members.isLoading ? <Skeleton rows={5} label="Đang tải danh sách nhân viên" />
          : members.isError ? <ErrorBanner text="Không tải được danh sách nhân viên cơ sở." onRetry={() => void members.refetch()} />
          : roster.length === 0 ? <div className="empty small" data-testid="status-compare-empty"><Users size={18} /><p>Không có nhân viên được phép đối chiếu.</p></div>
          : (
            <ul className="month-list" data-testid="list-compare-members">
              {roster.map((m) => (
                <li key={m.id}><button type="button" className="choice-row" onClick={() => pick(m.id)} data-testid={`button-compare-member-${m.id}`}>
                  <span className="initials" aria-hidden="true">{m.name.slice(0, 1).toUpperCase()}</span><strong className="grow">{m.label}</strong><Scale size={15} aria-hidden="true" />
                </button></li>
              ))}
            </ul>
          )
      ) : (
        <div className="compare">
          <h3 data-testid="text-comparison-source">Cơ sở · {selectedMember?.label} · {rangeLabel}</h3>
          <button type="button" className="back as-button" disabled={sync.isPending} onClick={() => pick(null)} data-testid="button-compare-change"><ArrowLeft size={14} />Chọn nhân viên khác</button>
          <div className="seg" role="tablist" aria-label="Phạm vi đối chiếu">
            <button type="button" role="tab" aria-selected={scope === 'day'} className={scope === 'day' ? 'active' : ''} disabled={sync.isPending} onClick={() => { setScope('day'); setConfirming(false); }} data-testid="tab-cmp-day">Đối chiếu ngày</button>
            <button type="button" role="tab" aria-selected={scope === 'month'} className={scope === 'month' ? 'active' : ''} disabled={sync.isPending} onClick={() => { setScope('month'); setConfirming(false); }} data-testid="tab-cmp-month">Đối chiếu tháng</button>
          </div>
          {notice && result !== 'matched' && <div className="banner success" role="status" data-testid="status-sync-success"><Check size={15} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Đóng">Đóng</button></div>}
          {syncError && <div className="banner danger" role="alert" data-testid="status-sync-error"><AlertCircle size={15} /><span>{syncError}</span></div>}
          {cmp.isLoading || cmp.isFetching ? <Skeleton rows={4} label="Đang tải đối chiếu mới nhất" />
            : cmp.isError || !d ? <ErrorBanner text="Không đối chiếu được. Hãy thử lại." onRetry={() => void cmp.refetch()} />
            : confirming ? (
              <div className="danger-box" role="alertdialog" aria-labelledby="sync-title" data-testid="dialog-sync-confirm">
                <h3 id="sync-title"><AlertTriangle size={16} aria-hidden="true" />Thay sổ bằng dữ liệu cơ sở?</h3>
                <ul>
                  <li>Nhân viên: <strong>{selectedMember?.label}</strong></li>
                  <li>Phạm vi: <strong>{scope === 'day' ? `Ngày ${formatShortDate(date)}` : formatMonth(month)}</strong></li>
                  <li>Xóa <strong data-testid="text-sync-removed">{personal.length}</strong> ca trong sổ của bạn</li>
                  <li>Nhập <strong data-testid="text-sync-imported">{reference.length}</strong> ca từ cơ sở (giữ nguyên giá công đã ghi lúc đó)</li>
                </ul>
                <p><strong>TẤT CẢ ca hiện có trong sổ của bạn trong {rangeLabel} sẽ bị thay thế, kể cả ca bạn tự nhập.</strong> Không thể hoàn tác. Các ngày khác, tài khoản khác và dữ liệu cơ sở không bị ảnh hưởng.</p>
                <div className="dialog-actions">
                  <button type="button" className="btn ghost" disabled={sync.isPending} onClick={() => setConfirming(false)} data-testid="button-cancel-sync">Hủy</button>
                  <button type="button" className="btn danger" disabled={sync.isPending} aria-busy={sync.isPending} onClick={runSync} data-testid="button-confirm-sync">{sync.isPending && <LoaderCircle size={14} className="spin" />}Thay thế {personal.length} ca bằng {reference.length} ca</button>
                </div>
              </div>
            ) : (<>
              {result === 'matched' ? (
                <div className="cmp-ok" role="status" aria-live="polite" data-testid="status-cmp-match"><CheckCircle2 size={16} />Dữ liệu đã khớp trong {rangeLabel}.</div>
              ) : result === 'empty' ? (
                <div className="cmp-ok" role="status" data-testid="status-cmp-empty">Chưa có ca chấm công trong {rangeLabel} để đối chiếu.</div>
              ) : (
                <section className="cmp-section" aria-labelledby="cmp-disc" data-testid="section-cmp-discrepancies">
                  <h3 id="cmp-disc">Tổng giờ chưa khớp theo dịch vụ</h3>
                  {serviceDifferences.map((difference, i) => (
                    <CompactDifference key={difference.serviceName} {...difference} index={i} />
                  ))}
                </section>
              )}
              <button type="button" className="btn" disabled={sync.isPending || cmp.isFetching} onClick={() => { setSyncError(''); setNotice(''); setConfirming(true); }} data-testid="button-open-sync">
                <RefreshCw size={14} />Cập nhật dữ liệu từ cơ sở
              </button>
            </>)}
        </div>
      )}
    </Modal>
  );
}
