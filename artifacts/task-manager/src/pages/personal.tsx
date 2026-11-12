import { useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPersonalComparisonQueryKey, getGetPersonalNotebookQueryKey,
  useCreatePersonalService, useCreatePersonalSession, useDeletePersonalService, useDeletePersonalSession,
  useGetPersonalNotebook, useUpdatePersonalService, useUpdatePersonalSession, useUpdatePersonalSettings,
} from '@workspace/api-client-react';
import type { AuthStatus, PersonalService, PersonalSession } from '@workspace/api-client-react';
import { serviceAttendanceLabel, summarizeServiceAttendance } from '@/lib/service-duration-summary';
import { AlertCircle, ArrowLeft, BookHeart, Building2, CalendarDays, Check, ChevronLeft, ChevronRight, CreditCard, Home, Keyboard, KeyRound, LogIn, Menu, Plus, Scale, X } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { ConfirmDialog, ErrorBanner, Modal, Skeleton, type ConfirmState } from '@/components/modal';
import { DatePickerDialog } from '@/components/date-picker-dialog';
import { defaultDateFor } from '@/components/history-months-dialog';
import { ComparisonDialog } from '@/components/personal/comparison-dialog';
import { PersonalServiceDialog, PersonalShiftDialog } from '@/components/personal/personal-dialogs';
import { ServiceList, ShiftList } from '@/components/personal/personal-lists';
import { KeyboardShortcutsSettings } from '@/components/keyboard-shortcuts-settings';
import { BusinessAccessSettings } from '@/components/business-access-settings';
import { PlatformBillingAdmin } from '@/components/platform-billing-admin';
import type { BusinessRolePreference } from '@/lib/business-role-preference';
import { formatShortDate, formatShortDayMonth } from '@/lib/attendance';
import { errorText, formatMinutes, formatMonth, formatVnd, monthOf, shiftMonth } from '@/lib/massage';
import { resolveRevenuePeriod, vietnamToday } from '@/lib/revenue-period';
import { submitActiveDialogForm, useDeviceKeyboardShortcuts, type KeyboardShortcutAction } from '@/lib/keyboard-shortcuts';

function PersonalFrame({ children, onSignOut, onOpenSettings, homeHref, onTouchStart, onTouchEnd, onTouchCancel }: {
  children: ReactNode;
  onSignOut?: () => void;
  onOpenSettings?: () => void;
  homeHref: string | null;
  onTouchStart?: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchEnd?: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchCancel?: () => void;
}) {
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
          {onSignOut && <button type="button" className="link-soft as-button p-logout" onClick={onSignOut} data-testid="button-personal-sign-out">Đăng xuất</button>}
          <Link href="/personal" className="brand" data-testid="link-personal-brand"><span className="brand-mark p-mark"><BookHeart size={15} strokeWidth={2.4} aria-hidden="true" /></span><span>SỔ CỦA TÔI</span></Link>
          <span className="p-pill" data-testid="status-personal">Riêng tư · chỉ bạn thấy</span>
          {onOpenSettings && <button type="button" className="gear-btn" aria-label="Cài đặt" onClick={onOpenSettings} data-testid="button-personal-settings"><Menu size={20} strokeWidth={2.5} aria-hidden="true" /></button>}
        </div>
      </header>
      <main className="p-main" id="main" tabIndex={-1} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={onTouchCancel}>
        {children}
        <nav className="screen-nav" aria-label="Điều hướng trang">
          {homeHref && <Link href={homeHref} className="btn ghost nav-home-action" data-testid="link-personal-home"><Home size={15} aria-hidden="true" />Về sổ cơ sở</Link>}
          <button type="button" className="btn ghost nav-return-action" onClick={() => window.history.back()} data-testid="button-personal-back"><ArrowLeft size={15} aria-hidden="true" />Trở về</button>
        </nav>
      </main>
    </div>
  );
}

export function PersonalSignInRequired({ authConfigured }: { authConfigured: boolean }) {
  return (
    <PersonalFrame homeHref={null}>
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

type Dlg = { kind: 'service'; item: PersonalService | null } | { kind: 'shift'; item: PersonalSession | null } | { kind: 'compare' } | { kind: 'date' };

function shiftDay(date: string, delta: number) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + delta));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export default function PersonalPage({ onSignOut, homeHref = '/', businessStatus, onBusinessSelected, onContinuePersonal, onRefreshStatus, onRoleSelected }: {
  onSignOut?: () => void;
  homeHref?: string | null;
  businessStatus: AuthStatus;
  onBusinessSelected: (id: string) => Promise<void>;
  onContinuePersonal: () => void;
  onRefreshStatus: () => Promise<AuthStatus | undefined>;
  onRoleSelected: (role: BusinessRolePreference) => void;
}) {
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
  const [pendingHistorySpeech, setPendingHistorySpeech] = useState<PersonalSession | null>(null);
  const [shortcutSettingsOpen, setShortcutSettingsOpen] = useState(false);
  const [personalSettingsPanel, setPersonalSettingsPanel] = useState<'business' | 'accounts' | 'billing' | 'shortcuts' | null>(null);

  const createService = useCreatePersonalService();
  const updateService = useUpdatePersonalService();
  const deleteService = useDeletePersonalService();
  const createShift = useCreatePersonalSession();
  const updateShift = useUpdatePersonalSession();
  const deleteShift = useDeletePersonalSession();
  const updateSettings = useUpdatePersonalSettings();
  const [mode, setMode] = useState<'day' | 'month'>('day');
  const [settingError, setSettingError] = useState('');
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
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
  function startDaySwipe(event: ReactTouchEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('button, a, input, select, textarea, [role="dialog"], .settings-overlay, [contenteditable="true"]') || event.touches.length !== 1) {
      swipeStart.current = null;
      return;
    }
    const touch = event.touches[0];
    swipeStart.current = { x: touch.clientX, y: touch.clientY };
  }
  function finishDaySwipe(event: ReactTouchEvent<HTMLElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    const nextDate = shiftDay(date, deltaX > 0 ? -1 : 1);
    if (nextDate <= today) {
      setMode('day');
      goPeriod(monthOf(nextDate), nextDate);
    }
  }
  function open(next: Dlg) { setDialogError(''); setDlg(next); }

  const data = nb.data;
  const sessions = useMemo(() => [...(data?.sessions ?? [])].sort((a, b) => b.workDate.localeCompare(a.workDate) || b.id - a.id), [data?.sessions]);
  const daySessions = sessions.filter((s) => s.workDate === date);
  useEffect(() => {
    if (!pendingHistorySpeech) return;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setPendingHistorySpeech(null);
      return;
    }

    let announced = false;
    const rowSelector = `[data-testid="row-personal-shift-${pendingHistorySpeech.id}"]`;
    const expectedText = [
      formatShortDayMonth(pendingHistorySpeech.workDate),
      pendingHistorySpeech.serviceName,
      formatMinutes(pendingHistorySpeech.minutes),
      formatVnd(pendingHistorySpeech.earnings),
    ];
    const speakHistoryRow = () => {
      if (announced) return;
      const row = document.querySelector<HTMLElement>(rowSelector);
      if (!row) return;

      const historyText = Array.from(row.children)
        .filter((element) => element.matches('.p-date, .personal-shift-details, .p-earn'))
        .map((element) => (element as HTMLElement).innerText || element.textContent || '')
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!historyText || !expectedText.every((part) => historyText.includes(part))) return;

      announced = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      try {
        const utterance = new SpeechSynthesisUtterance(historyText);
        utterance.lang = 'vi-VN';
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
      } catch {
        // Speech is an optional enhancement; the visible success message remains available.
      }
      setPendingHistorySpeech(null);
    };

    const observer = new MutationObserver(speakHistoryRow);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      setPendingHistorySpeech(null);
    }, 8000);
    speakHistoryRow();

    return () => {
      announced = true;
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [pendingHistorySpeech]);
  const monthServiceDetails = useMemo(() => summarizeServiceAttendance(sessions.map((s) => ({ serviceType: s.serviceName, minutes: s.minutes, visits: 1 }))), [sessions]);
  const dayServiceDetails = useMemo(() => summarizeServiceAttendance(daySessions.map((s) => ({ serviceType: s.serviceName, minutes: s.minutes, visits: 1 }))), [daySessions]);
  const monthTotalLabel = month === currentMonth ? 'Tổng lương tháng' : `Tổng lương ${formatMonth(month).toLocaleLowerCase('vi')}`;
  const dayTotalLabel = date === today ? 'Tổng lương hôm nay' : `Tổng lương ngày ${formatShortDayMonth(date)}`;
  const services = data?.services ?? [];
  const useFacility = data?.useFacilityRates === true;
  const canUseFacilityServices = Boolean(
    businessStatus.businessId && businessStatus.businessAccessAvailable !== false,
  );
  const canCompareFacilityEmployees = Boolean(
    businessStatus.businessId && businessStatus.businessAccessAvailable !== false &&
      (businessStatus.isOwner || businessStatus.permissions.compareAllEmployees ||
        businessStatus.permissions.compareEmployeeIds.length > 0),
  );
  function toggleFacility(next: boolean) {
    if (updateSettings.isPending) return;
    setSettingError('');
    updateSettings.mutate({ data: { useFacilityRates: next } }, {
      onSuccess: () => { refresh(); setNotice(next ? 'Đã chuyển sang dịch vụ và tiền công của cơ sở.' : 'Đã quay về dịch vụ riêng của bạn.'); },
      onError: (e) => { refresh(); setSettingError(errorText(e)); },
    });
  }

  const shortcutActions = useMemo<KeyboardShortcutAction[]>(() => {
    const actions: KeyboardShortcutAction[] = [
      { id: 'personal-shortcuts-settings', label: 'Mở cài đặt phím tắt cá nhân', group: 'Điều hướng chung', run: () => setShortcutSettingsOpen(true) },
      { id: 'personal-back', label: 'Trở về trong sổ cá nhân', group: 'Điều hướng chung', run: () => window.history.back() },
      { id: 'save-active-form', label: 'Lưu biểu mẫu đang mở', group: 'Biểu mẫu', allowInDialog: true, allowWhenEditing: true, run: submitActiveDialogForm },
      { id: 'choose-date', label: 'Chọn ngày', group: 'Chấm công cá nhân', run: () => open({ kind: 'date' }) },
      { id: 'view-day', label: 'Xem ca trong ngày', group: 'Chấm công cá nhân', run: () => setMode('day') },
      { id: 'view-month', label: 'Xem ca trong tháng', group: 'Chấm công cá nhân', run: () => setMode('month') },
      { id: 'previous-month', label: 'Xem tháng trước', group: 'Chấm công cá nhân', run: () => goPeriod(shiftMonth(month, -1)) },
    ];
    actions.push({ id: 'compare', label: 'Đối chiếu sổ cá nhân', group: 'Chấm công cá nhân', run: () => open({ kind: 'compare' }) });
    if (homeHref) actions.push({ id: 'facility-home', label: 'Về sổ cơ sở', group: 'Điều hướng chung', run: () => navigate(homeHref) });
    if (month < currentMonth) actions.push({ id: 'next-month', label: 'Xem tháng sau', group: 'Chấm công cá nhân', run: () => goPeriod(shiftMonth(month, 1)) });
    if (services.length) actions.push({ id: 'new-shift', label: 'Ghi ca cá nhân', group: 'Chấm công cá nhân', run: () => open({ kind: 'shift', item: null }) });
    if (!useFacility) actions.push({ id: 'new-service', label: 'Thêm dịch vụ cá nhân', group: 'Chấm công cá nhân', run: () => open({ kind: 'service', item: null }) });
    return actions;
  }, [currentMonth, goPeriod, homeHref, month, navigate, open, services.length, useFacility]);

  useDeviceKeyboardShortcuts(shortcutActions);

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
    <PersonalFrame onSignOut={onSignOut} onOpenSettings={() => setShortcutSettingsOpen(true)} homeHref={homeHref} onTouchStart={startDaySwipe} onTouchEnd={finishDaySwipe} onTouchCancel={() => { swipeStart.current = null; }}>
      {businessStatus.businessAccessAvailable === false && (
        <div className="banner danger" role="status" data-testid="status-business-access-unavailable">
          Kho doanh nghiệp chưa sẵn sàng. Sổ cá nhân vẫn dùng được; chưa thể mở, tạo hoặc tham gia cơ sở.
        </div>
      )}
      <section className="p-hero" aria-labelledby="p-title" data-testid="section-personal-hero">
        <div className="month-nav">
          <button type="button" className="icon-btn" onClick={() => goPeriod(shiftMonth(month, -1))} aria-label="Tháng trước" data-testid="button-personal-prev-month"><ChevronLeft size={16} /></button>
          <div className="personal-period personal-month-summary" data-testid="card-personal-month-total">
            <h1 id="p-title">{monthTotalLabel}</h1>
            <span className="personal-month-period">{formatMonth(month)}</span>
            {nb.isLoading ? <span className="rev-skel" role="status" aria-label="Đang tải tổng lương tháng" /> : !data ? (
              <span className="muted small" role="status" data-testid="status-personal-totals-unavailable">Chưa xem được tổng thu nhập — sổ chưa tải được.</span>
            ) : (
              <>
                <p className="p-big mono" data-testid="text-personal-month-total">{formatVnd(data.totalMonth)}</p>
                <ul className="service-duration-list" aria-label="Chi tiết ca dịch vụ trong tháng" data-testid="list-personal-month-service-durations">
                  {monthServiceDetails.length ? monthServiceDetails.map((item) => <li key={item.serviceType}>{serviceAttendanceLabel(item, formatMinutes)}</li>) : <li>Chưa có ca dịch vụ</li>}
                </ul>
              </>
            )}
          </div>
          <button type="button" className="icon-btn" disabled={month >= currentMonth} onClick={() => goPeriod(shiftMonth(month, 1))} aria-label="Tháng sau" data-testid="button-personal-next-month"><ChevronRight size={16} /></button>
        </div>
        {data && (
          <div className="p-totals">
            <div className="p-total-card" data-testid="card-personal-day-total"><span className="rev-label">{dayTotalLabel}</span><p className="p-mid mono" data-testid="text-personal-day-total">{formatVnd(data.totalDay)}</p>
              <ul className="service-duration-list" aria-label={`Chi tiết ca dịch vụ ngày ${formatShortDayMonth(date)}`} data-testid="list-personal-day-service-durations">
                {dayServiceDetails.length ? dayServiceDetails.map((item) => <li key={item.serviceType}>{serviceAttendanceLabel(item, formatMinutes)}</li>) : <li>Chưa có ca dịch vụ</li>}
              </ul>
            </div>
          </div>
        )}
        <div className="p-actions">
          <button type="button" className="btn primary" disabled={!data || !services.length} onClick={() => open({ kind: 'shift', item: null })} data-testid="button-add-personal-shift"><Plus size={15} />Ghi ca</button>
          <button type="button" className="btn" onClick={() => open({ kind: 'date' })} data-testid="button-personal-date"><CalendarDays size={14} />{formatShortDate(date)}</button>
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
              <h2 className="day-title"><CalendarDays size={16} aria-hidden="true" />{mode === 'day' ? 'Ca trong ngày' : `Tất cả ca ${formatMonth(month).toLowerCase()}`}</h2>
              <div className="seg" role="tablist" aria-label="Chế độ xem ca">
                <button type="button" role="tab" aria-selected={mode === 'day'} className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')} data-testid="tab-personal-day">Ngày</button>
                <button type="button" role="tab" aria-selected={mode === 'month'} className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')} data-testid="tab-personal-month">Tháng</button>
              </div>
              {mode === 'day'
                ? <ShiftList sessions={daySessions} busy={deleteShift.isPending} emptyText="Chưa có ca nào trong ngày này." testId="day-shifts"
                    onEdit={(s) => open({ kind: 'shift', item: s })} onDelete={askDeleteShift} />
                : <ShiftList sessions={sessions} busy={deleteShift.isPending} emptyText="Tháng này chưa có ca." testId="month-shifts"
                    onEdit={(s) => open({ kind: 'shift', item: s })} onDelete={askDeleteShift}
                    onSelectDate={(workDate) => { setMode('day'); goPeriod(monthOf(workDate), workDate); }} />}
            </section>
            <ServiceList services={services} busy={deleteService.isPending} useFacility={useFacility} canUseFacility={canUseFacilityServices}
              settingBusy={updateSettings.isPending} settingError={settingError} onToggleFacility={toggleFacility} onAdd={() => open({ kind: 'service', item: null })}
              onEdit={(s) => open({ kind: 'service', item: s })} onDelete={askDeleteService} />
          </div>
        )}

      {dlg?.kind === 'service' && !useFacility && <PersonalServiceDialog service={dlg.item} busy={createService.isPending || updateService.isPending} serverError={dialogError} onClose={() => setDlg(null)}
        onSubmit={(input) => dlg.item
          ? updateService.mutate({ id: dlg.item.id, data: input }, { onSuccess: () => done('Đã cập nhật dịch vụ.'), onError: failed })
          : createService.mutate({ data: input }, { onSuccess: () => done('Đã thêm dịch vụ.'), onError: failed })} />}
      {dlg?.kind === 'shift' && <PersonalShiftDialog session={dlg.item} services={services} defaultDate={date} maxDate={today} busy={createShift.isPending || updateShift.isPending} serverError={dialogError} onClose={() => setDlg(null)}
        onSubmit={(input) => { setDialogError(''); return dlg.item
          ? updateShift.mutate({ id: dlg.item.id, data: input }, { onSuccess: (saved) => { setPendingHistorySpeech(saved); done('Đã cập nhật ca.'); goSaved(saved.workDate); }, onError: failed })
          : createShift.mutate({ data: input }, { onSuccess: (saved) => { setPendingHistorySpeech(saved); done('Đã ghi ca.'); goSaved(saved.workDate); }, onError: failed }); }} />}
      {dlg?.kind === 'compare' && <ComparisonDialog month={month} date={date} canCompare={canCompareFacilityEmployees} onClose={() => setDlg(null)} onUpdated={refresh} />}
      {dlg?.kind === 'date' && <DatePickerDialog value={date} title="Chọn ngày" immediate onClose={() => setDlg(null)} onSelect={(d) => { setDlg(null); goPeriod(monthOf(d), d); }} />}
      {confirm && <ConfirmDialog state={confirm} busy={deleteService.isPending || deleteShift.isPending} onClose={() => setConfirm(null)} />}
      {shortcutSettingsOpen && <Modal
        title={personalSettingsPanel ? ({
          business: 'Doanh nghiệp và mã tham gia',
          accounts: 'Quản lý tài khoản người dùng',
          billing: 'Phí và thanh toán',
          shortcuts: 'Phím tắt',
        } as const)[personalSettingsPanel] : 'Cài đặt'}
        description={personalSettingsPanel
          ? 'Thiết lập riêng cho mục đã chọn.'
          : 'Chọn một mục để mở màn hình cài đặt riêng.'}
        onClose={() => { setShortcutSettingsOpen(false); setPersonalSettingsPanel(null); }}
        testId="dialog-personal-settings">
        {personalSettingsPanel ? <>
          <button type="button" className="settings-link settings-panel-back" onClick={() => setPersonalSettingsPanel(null)} data-testid="button-personal-settings-back">
            <ArrowLeft size={15} aria-hidden="true" /><span>Quay lại Cài đặt</span>
          </button>
          {personalSettingsPanel === 'business' && <BusinessAccessSettings status={businessStatus} onBusinessSelected={onBusinessSelected}
            onContinuePersonal={() => { setShortcutSettingsOpen(false); setPersonalSettingsPanel(null); onContinuePersonal(); }}
            onRefreshStatus={onRefreshStatus}
            onCloseSettings={() => { setShortcutSettingsOpen(false); setPersonalSettingsPanel(null); }}
            onRoleSelected={onRoleSelected} />}
          {personalSettingsPanel === 'accounts' && businessStatus.isPlatformAdmin && <PlatformBillingAdmin view="accounts" />}
          {personalSettingsPanel === 'billing' && businessStatus.isPlatformAdmin && <PlatformBillingAdmin view="billing" />}
          {personalSettingsPanel === 'shortcuts' && <KeyboardShortcutsSettings actions={shortcutActions} expanded />}
        </> : <>
          {businessStatus.isPlatformAdmin && <>
            <button type="button" className="settings-link platform-billing-entry" onClick={() => setPersonalSettingsPanel('accounts')}
              data-testid="button-open-personal-platform-accounts">
              <KeyRound size={16} aria-hidden="true" />
              <span><strong>Quản lý tài khoản người dùng</strong><span>Xem thời hạn dùng thử, gói và quyền</span></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button type="button" className="settings-link platform-billing-entry" onClick={() => setPersonalSettingsPanel('billing')}
              data-testid="button-open-personal-platform-billing">
              <CreditCard size={16} aria-hidden="true" />
              <span><strong>Phí và thanh toán</strong><span>Bật phí và duyệt thanh toán</span></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </>}
          <button type="button" className="settings-link" onClick={() => setPersonalSettingsPanel('business')} data-testid="button-personal-settings-business">
            <Building2 size={16} aria-hidden="true" /><span><strong>Doanh nghiệp và mã tham gia</strong><span>Quản lý cơ sở và mã kết nối</span></span><ChevronRight size={16} aria-hidden="true" />
          </button>
          <button type="button" className="settings-link" onClick={() => setPersonalSettingsPanel('shortcuts')} data-testid="button-personal-settings-shortcuts">
            <Keyboard size={16} aria-hidden="true" /><span><strong>Phím tắt</strong><span>Gán thao tác cho bàn phím trên thiết bị</span></span><ChevronRight size={16} aria-hidden="true" />
          </button>
        </>}
      </Modal>}
    </PersonalFrame>
  );
}
