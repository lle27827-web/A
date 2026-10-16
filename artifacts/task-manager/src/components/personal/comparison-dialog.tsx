import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPersonalComparisonQueryKey, getGetPersonalNotebookQueryKey, getListMembersQueryKey,
  useGetPersonalComparison, useListMembers, useSyncPersonalNotebook,
} from '@workspace/api-client-react';
import type { PersonalComparisonVisit } from '@workspace/api-client-react';
import { AlertCircle, AlertTriangle, ArrowLeft, Check, CheckCircle2, LoaderCircle, RefreshCw, Scale, Users } from 'lucide-react';
import { Modal, ErrorBanner, Skeleton } from '@/components/modal';
import { formatShortDate } from '@/lib/attendance';
import { errorText, formatMinutes, formatMonth, formatVnd } from '@/lib/massage';

type Scope = 'day' | 'month';

function Diff({ value, testId }: { value: number; testId: string }) {
  const cls = value > 0 ? 'pos' : value < 0 ? 'neg' : '';
  return <strong className={`mono diff ${cls}`} data-testid={testId}>{value > 0 ? '+' : ''}{formatVnd(value)}</strong>;
}

function Visit({ v, side }: { v: PersonalComparisonVisit; side: string }) {
  return (
    <div className="cmp-visit" data-testid={`row-cmp-${side}-${v.id}`}>
      <strong>{v.serviceName}</strong>
      <span className="muted">{formatShortDate(v.workDate)}{v.customerName ? ` · Khách: ${v.customerName}` : ''}</span>
      <span className="mono">{formatMinutes(v.minutes)} · {formatVnd(v.hourlyRate)}/giờ · <strong>{formatVnd(v.earnings)}</strong></span>
      {v.note && <span className="muted">{v.note}</span>}
    </div>
  );
}

function Cols({ personal, reference, refName, side }: { personal: PersonalComparisonVisit[]; reference: PersonalComparisonVisit[]; refName: string; side: string }) {
  return (
    <div className="cmp-cols">
      <div className="cmp-col"><span>Sổ của tôi · {personal.length}</span>
        {personal.length ? personal.map((v) => <Visit key={v.id} v={v} side={`${side}-p`} />) : <span className="cmp-none">Không có ca</span>}</div>
      <div className="cmp-col"><span>Cơ sở · {refName} · {reference.length}</span>
        {reference.length ? reference.map((v) => <Visit key={v.id} v={v} side={`${side}-r`} />) : <span className="cmp-none">Không có ca</span>}</div>
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
  const memberParams = useMemo(() => ({ month }), [month]);
  const members = useListMembers(memberParams, { query: { queryKey: getListMembersQueryKey(memberParams), staleTime: 30_000, refetchOnWindowFocus: true } });
  const params = useMemo(() => ({ memberId: memberId ?? 0, month, date }), [memberId, month, date]);
  const cmp = useGetPersonalComparison(params, { query: { queryKey: getGetPersonalComparisonQueryKey(params), enabled: memberId !== null, staleTime: 15_000, refetchOnMount: true, refetchOnWindowFocus: !confirming, refetchInterval: confirming ? false : 60_000 } });
  const sync = useSyncPersonalNotebook();

  const d = cmp.data;
  const inScope = (v: PersonalComparisonVisit) => scope === 'month' || v.workDate === date;
  const personal = (d?.personalVisits ?? []).filter(inScope);
  const reference = (d?.referenceVisits ?? []).filter(inScope);
  const discrepancies = (d?.discrepancies ?? []).filter((x) => scope === 'month' || [...x.personal, ...x.reference].some((v) => v.workDate === date));
  const rangeLabel = scope === 'day' ? `ngày ${formatShortDate(date)}` : formatMonth(month).toLowerCase();

  function pick(id: number | null) { setMemberId(id); setConfirming(false); setSyncError(''); setNotice(''); }
  function runSync() {
    if (!d || memberId === null || syncing.current || sync.isPending) return;
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
    <Modal title="Đối chiếu tiền công" description={`So sánh từng ca trong sổ của bạn với một nhân viên cơ sở · ${formatMonth(month)}, ngày ${formatShortDate(date)}.`} onClose={onClose} testId="dialog-comparison">
      {memberId === null ? (
        members.isLoading ? <Skeleton rows={5} label="Đang tải danh sách nhân viên" />
          : members.isError ? <ErrorBanner text="Không tải được danh sách nhân viên cơ sở." onRetry={() => void members.refetch()} />
          : (members.data ?? []).length === 0 ? <div className="empty small" data-testid="status-compare-empty"><Users size={18} /><p>Cơ sở không có nhân viên nào trong {formatMonth(month).toLowerCase()}.</p></div>
          : (
            <ul className="month-list" data-testid="list-compare-members">
              {(members.data ?? []).map((m) => (
                <li key={m.id}><button type="button" className="choice-row" onClick={() => pick(m.id)} data-testid={`button-compare-member-${m.id}`}>
                  <span className="initials">{m.name.slice(0, 1).toUpperCase()}</span><strong className="grow">{m.name}</strong><Scale size={15} aria-hidden="true" />
                </button></li>
              ))}
            </ul>
          )
      ) : (
        <div className="compare">
          <button type="button" className="back as-button" disabled={sync.isPending} onClick={() => pick(null)} data-testid="button-compare-change"><ArrowLeft size={14} />Chọn nhân viên khác</button>
          <div className="seg" role="tablist" aria-label="Phạm vi đối chiếu">
            <button type="button" role="tab" aria-selected={scope === 'day'} className={scope === 'day' ? 'active' : ''} disabled={sync.isPending} onClick={() => { setScope('day'); setConfirming(false); }} data-testid="tab-cmp-day">Đối chiếu ngày</button>
            <button type="button" role="tab" aria-selected={scope === 'month'} className={scope === 'month' ? 'active' : ''} disabled={sync.isPending} onClick={() => { setScope('month'); setConfirming(false); }} data-testid="tab-cmp-month">Đối chiếu tháng</button>
          </div>
          {notice && <div className="banner success" role="status" data-testid="status-sync-success"><Check size={15} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Đóng">Đóng</button></div>}
          {syncError && <div className="banner danger" role="alert" data-testid="status-sync-error"><AlertCircle size={15} /><span>{syncError}</span></div>}
          {cmp.isLoading ? <Skeleton rows={4} label="Đang đối chiếu" />
            : cmp.isError || !d ? <ErrorBanner text="Không đối chiếu được. Hãy thử lại." onRetry={() => void cmp.refetch()} />
            : confirming ? (
              <div className="danger-box" role="alertdialog" aria-labelledby="sync-title" data-testid="dialog-sync-confirm">
                <h3 id="sync-title"><AlertTriangle size={16} aria-hidden="true" />Thay sổ bằng dữ liệu cơ sở?</h3>
                <ul>
                  <li>Nhân viên: <strong>{d.memberName}</strong></li>
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
              <section className="cmp-section" aria-labelledby="cmp-disc" data-testid="section-cmp-discrepancies">
                <h3 id="cmp-disc">Khác biệt · {discrepancies.length}</h3>
                {discrepancies.length === 0
                  ? <div className="cmp-ok" data-testid="status-cmp-match"><CheckCircle2 size={16} />Không có khác biệt trong {rangeLabel}.</div>
                  : discrepancies.map((x, i) => (
                    <div className="cmp-disc" key={i} data-testid={`row-cmp-discrepancy-${i}`}>
                      <strong>{x.reason}</strong>
                      <Cols personal={x.personal} reference={x.reference} refName={d.memberName} side={`d${i}`} />
                    </div>
                  ))}
              </section>
              <table className="data-table compare-table" data-testid="table-comparison">
                <thead><tr><th scope="col"></th><th scope="col">{scope === 'day' ? `Ngày ${formatShortDate(date)}` : formatMonth(month)}</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Sổ của tôi</th><td className="mono" data-testid="text-cmp-personal">{formatVnd(scope === 'day' ? d.personalDay : d.personalMonth)}</td></tr>
                  <tr><th scope="row">Cơ sở · {d.memberName}</th><td className="mono" data-testid="text-cmp-ref">{formatVnd(scope === 'day' ? d.referenceDay : d.referenceMonth)}</td></tr>
                  <tr className="diff-row"><th scope="row">Chênh lệch</th><td><Diff value={scope === 'day' ? d.differenceDay : d.differenceMonth} testId="text-cmp-diff" /></td></tr>
                </tbody>
              </table>
              <p className="hint" data-testid="text-cmp-explainer">Chênh lệch = sổ của tôi − cơ sở. Số dương: sổ của bạn ghi nhiều hơn.</p>
              <section className="cmp-section" aria-labelledby="cmp-all" data-testid="section-cmp-visits">
                <h3 id="cmp-all">Tất cả ca trong {rangeLabel}</h3>
                <Cols personal={personal} reference={reference} refName={d.memberName} side="all" />
              </section>
              <button type="button" className="btn" disabled={sync.isPending || cmp.isFetching} onClick={() => { setSyncError(''); setNotice(''); setConfirming(true); }} data-testid="button-open-sync">
                <RefreshCw size={14} />Cập nhật dữ liệu từ cơ sở
              </button>
            </>)}
        </div>
      )}
    </Modal>
  );
}
