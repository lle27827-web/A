import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPersonalComparisonQueryKey, getGetPersonalNotebookQueryKey,
  useCreatePersonalService, useCreatePersonalSession, useDeletePersonalService, useDeletePersonalSession,
  useGetPersonalNotebook, useUpdatePersonalService, useUpdatePersonalSession, useUpdatePersonalSettings,
} from '@workspace/api-client-react';
import type { PersonalService, PersonalSession } from '@workspace/api-client-react';
import { summarizeServiceDurations, serviceDurationLabel } from '@/lib/service-duration-summary';
import { AlertCircle, ArrowLeft, BookHeart, CalendarDays, Check, ChevronLeft, ChevronRight, History, Home, LogIn, Plus, Scale, X } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { ConfirmDialog, ErrorBanner, Skeleton, type ConfirmState } from '@/components/modal';
import { DatePickerDialog } from '@/components/date-picker-dialog';
import { HistoryMonthsDialog, defaultDateFor } from '@/components/history-months-dialog';
import { ComparisonDialog } from '@/components/personal/comparison-dialog';
import { PersonalServiceDialog, PersonalShiftDialog } from '@/components/personal/personal-dialogs';
import { ServiceList, ShiftList } from '@/components/personal/personal-lists';
import { formatDate, formatShortDate } from '@/lib/attendance';
import { errorText, formatMinutes, formatMonth, formatVnd, monthOf, shiftMonth } from '@/lib/massage';
import { resolveRevenuePeriod, vietnamToday } from '@/lib/revenue-period';

function PersonalFrame({ children, onSignOut }: { children: ReactNode; onSignOut?: () => void }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const main = document.getElementById('main');
      const target = main?.querySelector<HTMLElement>('h1, h2') ?? main;
      if (target && !target.hasAttribute('tabindex')) target.tabIndex = -1;
      target?.focus({ preventScroll: false });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="personal">
      <a className="skip-link" href="#main" data-testid="link-personal-skip-main">Bỏ qua đến nội dung chính</a>
      <header className="p-top">
        <div className="p-top-inner">
          <Link href="/" className="brand" data-testid="link-personal-brand"><span className="brand-mark p-mark"><BookHeart size={15} strokeWidth={2.4} aria-hidden="true" /></span><span>SỔ CỦA TÔI</span></Link>
          <span className="p-pill" data-testid="status-personal">Riêng tư · chỉ bạn thấy</span>
          {onSignOut && <button type="button" className="link-soft as-button p-logout" onClick={onSignOut} data-testid="button-personal-sign-out">Đăng xuất</button>}
        </div>
      </header>
      <main className="p-main" id="main" tabIndex={-1}>
        {children}
        <nav className="screen-nav" aria-label="Điều hướng trang">
          <Link href="/" className="btn ghost" data-testid="link-personal-home"><Home size={15} aria-hidden="true" />Về sổ cơ sở</Link>
          <button type="button" className="btn ghost" onClick={() => window.history.back()} data-testid="button-personal-back"><ArrowLeft size={15} aria-hidden="true" />Trở về</button>
        </nav>
      </main>
    </div>
  );
}

export function PersonalSignInRequired({ authConfigured }: { authConfigured: boolean }) {
  return (
    <PersonalFrame>
      <section className="p-welcome" data-testid="section-personal-sign-in">
        <BookHeart size={30} aria-hidden="true" />
        <h1>Sổ chấm công của riêng bạn</h1>
        <p>Ghi ca, giá công và thu nhập của chính bạn — tách biệt hoàn toàn với dữ liệu cơ sở. Hãy đăng nhập để mở sổ.</p>
        {authConfigured
          ? <Link href="/sign-in?next=personal" className="btn primary" data-testid="link-personal-sign-in-page"><LogIn size={15} />Đăng nhập</Link>
          : <p className="hint">Đăng nhập chưa được cấu hình cho ứng dụng này.</p>}
      </section>
    </PersonalFrame>
  );
}

type Dlg = { kind: 'service'; item: PersonalService | null } | { kind: 'shift'; item: PersonalSession | null } | { kind: 'compare' } | { kind: 'history' } | { kind: 'date' };

export default function PersonalPage({ onSignOut }: { onSignOut?: () => void }) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const today = useMemo(() => vietnamToday(), []);
  const { month, date, currentMonth } = resolveRevenuePeriod(search, today);
  const params = useMemo(() => ({ month, date }), [month, date]);
  const nb = useGetPersonalNotebook(params, { query: { queryKey: getGetPersonalNotebookQueryKey(params), staleTime: 15_000, refetchOnMount: true, refetchOnWindowFocus: true, refetchInterval: 60_000 } });
  const cache = useQueryClient();
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const createService = useCreatePersonalService();
  const updateService = useUpdatePersonalService();
  const deleteService = useDeletePersonalService();
  const createShift = useCreatePersonalSession();
  const updateShift = useUpdatePersonalSession();
  const deleteShift = useDeletePersonalSession();
  const updateSettings = useUpdatePersonalSettings();
  const [mode, setMode] = useState<'day' | 'month'>('day');
  const [settingError, setSettingError] = useState('');

  function refresh() {
    void cache.invalidateQueries({ queryKey: getGetPersonalNotebookQueryKey() });
    void cache.invalidateQueries({ queryKey: getGetPersonalComparisonQueryKey() });
  }
  function goSaved(workDate: string) { if (/^\d{4}-\d{2}-\d{2}$/.test(workDate)) goPeriod(monthOf(workDate), workDate); }
  function done(msg: string) { refresh(); setDlg(null); setConfirm(null); setError(''); setNotice(msg); }
  function failed(e: unknown) { setDialogError(errorText(e)); setNotice(''); }
  function failedConfirm(e: unknown) { refresh(); setConfirm(null); setNotice(''); setError(errorText(e)); }
  function goPeriod(m: string, d?: string) {
    const next = m > currentMonth ? currentMonth : m;
    navigate(`/personal?month=${next}&date=${d && monthOf(d) === next ? d : defaultDateFor(next, today)}`);
  }
  function open(next: Dlg) { setDialogError(''); setDlg(next); }

  const data = nb.data;
  const sessions = useMemo(() => [...(data?.sessions ?? [])].sort((a, b) => b.workDate.localeCompare(a.workDate) || b.id - a.id), [data?.sessions]);
  const daySessions = sessions.filter((s) => s.workDate === date);
  const monthServiceDetails = useMemo(() => summarizeServiceDurations(sessions.map((s) => ({ serviceType: s.serviceName, minutes: s.minutes }))), [sessions]);
  const dayServiceDetails = useMemo(() => summarizeServiceDurations(daySessions.map((s) => ({ serviceType: s.serviceName, minutes: s.minutes }))), [daySessions]);
  const monthMinutes = sessions.reduce((a, s) => a + s.minutes, 0);
  const services = data?.services ?? [];
  const useFacility = data?.useFacilityRates === true;
  function toggleFacility(next: boolean) {
    if (updateSettings.isPending) return;
    setSettingError('');
    updateSettings.mutate({ data: { useFacilityRates: next } }, {
      onSuccess: () => { refresh(); setNotice(next ? 'Đã chuyển sang dịch vụ và tiền công của cơ sở.' : 'Đã quay về dịch vụ riêng của bạn.'); },
      onError: (e) => { refresh(); setSettingError(errorText(e)); },
    });
  }

  const askDeleteService = (s: PersonalService) => setConfirm({
    title: `Xóa dịch vụ ${s.name}?`,
    body: <p>Dịch vụ sẽ được lưu trữ và không còn hiện khi ghi ca mới. Các ca cũ vẫn giữ tên và giá đã ghi.</p>,
    confirmLabel: 'Xóa dịch vụ',
    dialogClassName: 'personal-surface-dialog',
    onConfirm: () => deleteService.mutate({ id: s.id }, { onSuccess: () => done('Đã xóa dịch vụ. Ca cũ vẫn được giữ.'), onError: failedConfirm }),
  });
  const askDeleteShift = (s: PersonalSession) => setConfirm({
    title: 'Xóa ca này?',
    body: <p>Xóa ca {s.serviceName} {formatMinutes(s.minutes)} ngày {formatShortDate(s.workDate)} ({formatVnd(s.earnings)}). Không thể hoàn tác.</p>,
    confirmLabel: 'Xóa ca',
    dialogClassName: 'personal-surface-dialog',
    onConfirm: () => deleteShift.mutate({ id: s.id }, { onSuccess: () => done('Đã xóa ca.'), onError: failedConfirm }),
  });

  return (
    <PersonalFrame onSignOut={onSignOut}>
      <section className="p-hero" aria-labelledby="p-title" data-testid="section-personal-hero">
        <div className="month-nav">
          <button type="button" className="icon-btn" onClick={() => goPeriod(shiftMonth(month, -1))} aria-label="Tháng trước" data-testid="button-personal-prev-month"><ChevronLeft size={16} /></button>
          <h1 id="p-title" className="rev-label">Thu nhập của tôi · {formatMonth(month)}</h1>
          <button type="button" className="icon-btn" disabled={month >= currentMonth} onClick={() => goPeriod(shiftMonth(month, 1))} aria-label="Tháng sau" data-testid="button-personal-next-month"><ChevronRight size={16} /></button>
        </div>
        {nb.isLoading ? <span className="rev-skel" role="status" aria-label="Đang tải sổ" /> : !data ? (
          <p className="muted" data-testid="status-personal-totals-unavailable">Chưa xem được tổng thu nhập — sổ chưa tải được.</p>
        ) : (
          <div className="p-totals">
            <div><span className="rev-label">Tổng doanh thu tháng</span><p className="p-big mono" data-testid="text-personal-month-total">{formatVnd(data?.totalMonth ?? 0)}</p><span className="muted small" data-testid="text-personal-month-count">{sessions.length} ca · {formatMinutes(monthMinutes)}</span>
              <ul className="service-duration-list" aria-label="Chi tiết ca dịch vụ trong tháng" data-testid="list-personal-month-service-durations">
                {monthServiceDetails.length ? monthServiceDetails.map((item) => <li key={`${item.serviceType}-${item.minutes}`}>{serviceDurationLabel(item, formatMinutes)}</li>) : <li>Chưa có ca dịch vụ</li>}
              </ul>
            </div>
            <div><span className="rev-label">Ngày {formatShortDate(date)}</span><p className="p-mid mono" data-testid="text-personal-day-total">{formatVnd(data?.totalDay ?? 0)}</p><span className="muted small" data-testid="text-personal-day-count">{daySessions.length} ca</span>
              <ul className="service-duration-list" aria-label={`Chi tiết ca dịch vụ ngày ${formatShortDate(date)}`} data-testid="list-personal-day-service-durations">
                {dayServiceDetails.length ? dayServiceDetails.map((item) => <li key={`${item.serviceType}-${item.minutes}`}>{serviceDurationLabel(item, formatMinutes)}</li>) : <li>Chưa có ca dịch vụ</li>}
              </ul>
            </div>
          </div>
        )}
        <div className="p-actions">
          <button type="button" className="btn primary" disabled={!data || !services.length} onClick={() => open({ kind: 'shift', item: null })} data-testid="button-add-personal-shift"><Plus size={15} />Ghi ca</button>
          <button type="button" className="btn" onClick={() => open({ kind: 'date' })} data-testid="button-personal-date"><CalendarDays size={14} />{formatShortDate(date)}</button>
          <button type="button" className="btn" onClick={() => open({ kind: 'history' })} data-testid="button-personal-history"><History size={14} />Lịch sử tháng</button>
          <button type="button" className="btn" onClick={() => open({ kind: 'compare' })} data-testid="button-personal-compare"><Scale size={14} />Đối chiếu</button>
        </div>
        {!nb.isLoading && !nb.isError && !services.length && <p className="hint" data-testid="text-personal-no-services">Thêm ít nhất một dịch vụ để bắt đầu ghi ca.</p>}
      </section>

      {error && <div className="banner danger" role="alert" data-testid="status-personal-error-banner"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Đóng"><X size={14} /></button></div>}
      {notice && <div className="banner success" role="status" data-testid="status-personal-success"><Check size={15} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Đóng"><X size={14} /></button></div>}

      {nb.isLoading ? <section className="p-card"><Skeleton rows={6} label="Đang tải sổ cá nhân" /></section>
        : nb.isError ? <section className="p-card" data-testid="status-personal-error"><ErrorBanner text={data ? "Không làm mới được sổ cá nhân; đang hiển thị dữ liệu cũ." : "Không tải được sổ cá nhân. Thu nhập tạm thời không hiển thị."} onRetry={() => void nb.refetch()} /></section>
        : (
          <div className="p-grid">
            <section className="p-card" aria-label="Ca của tôi" data-testid="section-personal-shifts">
              <h2 className="day-title"><CalendarDays size={16} aria-hidden="true" />{mode === 'day' ? formatDate(date) : `Tất cả ca ${formatMonth(month).toLowerCase()}`}</h2>
              <div className="seg" role="tablist" aria-label="Chế độ xem ca">
                <button type="button" role="tab" aria-selected={mode === 'day'} className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')} data-testid="tab-personal-day">Ngày · {daySessions.length}</button>
                <button type="button" role="tab" aria-selected={mode === 'month'} className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')} data-testid="tab-personal-month">Tháng · {sessions.length}</button>
              </div>
              {mode === 'day'
                ? <ShiftList sessions={daySessions} busy={deleteShift.isPending} emptyText="Chưa có ca nào trong ngày này." testId="day-shifts"
                    onEdit={(s) => open({ kind: 'shift', item: s })} onDelete={askDeleteShift} />
                : <ShiftList sessions={sessions} busy={deleteShift.isPending} emptyText="Tháng này chưa có ca." testId="month-shifts"
                    onEdit={(s) => open({ kind: 'shift', item: s })} onDelete={askDeleteShift}
                    onSelectDate={(workDate) => { setMode('day'); goPeriod(monthOf(workDate), workDate); }} />}
            </section>
            <ServiceList services={services} busy={deleteService.isPending} useFacility={useFacility} settingBusy={updateSettings.isPending} settingError={settingError} onToggleFacility={toggleFacility} onAdd={() => open({ kind: 'service', item: null })}
              onEdit={(s) => open({ kind: 'service', item: s })} onDelete={askDeleteService} />
          </div>
        )}

      {dlg?.kind === 'service' && !useFacility && <PersonalServiceDialog service={dlg.item} busy={createService.isPending || updateService.isPending} serverError={dialogError} onClose={() => setDlg(null)}
        onSubmit={(input) => dlg.item
          ? updateService.mutate({ id: dlg.item.id, data: input }, { onSuccess: () => done('Đã cập nhật dịch vụ.'), onError: failed })
          : createService.mutate({ data: input }, { onSuccess: () => done('Đã thêm dịch vụ.'), onError: failed })} />}
      {dlg?.kind === 'shift' && <PersonalShiftDialog session={dlg.item} services={services} defaultDate={date} maxDate={today} busy={createShift.isPending || updateShift.isPending} serverError={dialogError} onClose={() => setDlg(null)}
        onSubmit={(input) => { setDialogError(''); return dlg.item
          ? updateShift.mutate({ id: dlg.item.id, data: input }, { onSuccess: (saved) => { done('Đã cập nhật ca.'); goSaved(saved.workDate); }, onError: failed })
          : createShift.mutate({ data: input }, { onSuccess: (saved) => { done('Đã ghi ca.'); goSaved(saved.workDate); }, onError: failed }); }} />}
      {dlg?.kind === 'compare' && <ComparisonDialog month={month} date={date} onClose={() => setDlg(null)} onUpdated={refresh} />}
      {dlg?.kind === 'history' && <HistoryMonthsDialog title="Lịch sử sổ của tôi" months={data?.months ?? []} onClose={() => setDlg(null)}
        onPick={(m, d) => { setDlg(null); goPeriod(m, d); }} />}
      {dlg?.kind === 'date' && <DatePickerDialog value={date} title="Chọn ngày" immediate onClose={() => setDlg(null)} onSelect={(d) => { setDlg(null); goPeriod(monthOf(d), d); }} />}
      {confirm && <ConfirmDialog state={confirm} busy={deleteService.isPending || deleteShift.isPending} onClose={() => setConfirm(null)} />}
    </PersonalFrame>
  );
}
