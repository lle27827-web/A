import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getListMembersQueryKey, useListMembers } from '@workspace/api-client-react';
import type { FacilityPermissions, MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, BookHeart, CalendarDays, Check, CreditCard, Hand, History, Home, Search, Sparkles, Users, X } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { SearchResults } from '@/components/search-results';
import { ViewSettings, useViewPrefs, type ViewPrefs } from '@/components/view-settings';
import type { KeyboardShortcutAction } from '@/lib/keyboard-shortcuts';
import { submitActiveDialogForm, useDeviceKeyboardShortcuts } from '@/lib/keyboard-shortcuts';
import { errorText, formatMonth, SESSION_FRESHNESS } from '@/lib/massage';
import { periodHref, resolveRevenuePeriod } from '@/lib/revenue-period';
import { useVietnamToday } from '@/lib/use-vietnam-today';
import {
  DEFAULT_PRINT_PREFERENCES,
  readPrintPreferences,
  writePrintPreferences,
  type PrintPreferences,
} from '@/lib/printing';
import { primeSaveChime } from '@/lib/save-chime';

export const NO_PERMISSIONS: FacilityPermissions = {
  allEmployees: false, employeeIds: [], viewCards: false, viewRevenue: false,
  editEmployees: false, deleteEmployees: false, editCards: false, editServices: false, viewAppointments: false, editAppointments: false,
};
export const ALL_PERMISSIONS: FacilityPermissions = {
  allEmployees: true, employeeIds: [], viewCards: true, viewRevenue: true,
  editEmployees: true, deleteEmployees: true, editCards: true, editServices: true, viewAppointments: true, editAppointments: true,
};
export function hasFacilityAccess(p: FacilityPermissions): boolean {
  return p.allEmployees || p.employeeIds.length > 0 || p.viewCards || p.viewRevenue || p.editServices || p.viewAppointments || p.editAppointments;
}

type ShellCtx = {
  /** Alias of canEditEmployees (employee/session edits, not in history). */
  canEdit: boolean;
  /** Verified owner only: role/grant management. Never implies a manager. */
  isOwner: boolean;
  permissions: FacilityPermissions;
  canViewEmployees: boolean;
  /** editEmployees within scope, not in a historical month. */
  canEditEmployees: boolean;
  /** allEmployees + editEmployees, not in history. */
  canAddEmployees: boolean;
  /** Separate destructive capability, scoped to visible employees. */
  canDeleteEmployees: boolean;
  canEditCards: boolean;
  canEditServices: boolean;
  /** YYYY-MM when viewing a past month read-only, else null. */
  historyMonth: string | null;
  selectedHistoryDate: string | null;
  /** Month/date currently selected (current month when not in history). */
  period: { month: string; date: string; currentMonth: string; today: string };
  withHistory: (path: string) => string;
  employeeMode: boolean;
  prefs: ViewPrefs;
  members: MemberRecord[];
  membersLoading: boolean;
  membersError: boolean;
  retryMembers: () => void;
  query: string;
  setQuery: (q: string) => void;
  desktopLayout: boolean;
  notify: (msg: string) => void;
  fail: (err: unknown) => void;
  clearMessages: () => void;
  openSettings: () => void;
  setView: (next: ViewPrefs) => void;
  printPreferences: PrintPreferences;
  updatePrintPreferences: (next: PrintPreferences) => void;
};

const Ctx = createContext<ShellCtx | null>(null);
export function useShell() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useShell outside AppShell');
  return value;
}

export function AppShell({
  children,
  employeeView,
  desktopLeftPanel,
  businessSwitcher,
  isOwner,
  permissions,
  userId,
  authStatusMessage,
  onSignOut,
}: {
  children: ReactNode;
  employeeView: ReactNode;
  desktopLeftPanel?: ReactNode;
  businessSwitcher?: ReactNode;
  isOwner: boolean;
  permissions: FacilityPermissions;
  userId?: string | null;
  authStatusMessage?: string;
  onSignOut?: () => void;
}) {
  const [location, navigate] = useLocation();
  const [desktopLayout, setDesktopLayout] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches,
  );
  const [prefs, setPrefs] = useViewPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [printPreferences, setPrintPreferences] = useState<PrintPreferences>(() =>
    readPrintPreferences(userId),
  );
  const search = useSearch();
  const today = useVietnamToday();
  const resolved = resolveRevenuePeriod(search, today);
  const historyMonth = resolved.month < resolved.currentMonth ? resolved.month : null;
  const selectedHistoryDate = historyMonth ? resolved.date : null;
  const withHistory = (path: string) => periodHref(path, historyMonth, selectedHistoryDate);
  const homeHref = isOwner ? withHistory('/') : withHistory('/attendance');
  const memberParams = useMemo(() => (historyMonth ? { month: historyMonth } : undefined), [historyMonth]);
  const canViewEmployees = permissions.allEmployees || permissions.employeeIds.length > 0;
  const membersQuery = useListMembers(memberParams, { query: { queryKey: getListMembersQueryKey(memberParams), enabled: canViewEmployees, ...SESSION_FRESHNESS } });
  const canEditEmployees = canViewEmployees && permissions.editEmployees && !historyMonth;
  const canAddEmployees = permissions.allEmployees && permissions.editEmployees && !historyMonth;
  const canEditCards = permissions.viewCards && permissions.editCards && !historyMonth;
  const canEditServices = permissions.editServices && !historyMonth;
  const fullLocation = search ? `${location}?${search}` : location;
  const employeeRoute = /^\/employees(?:\/|$)/.test(location);
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const showResults = query.trim().length > 0;
  const employeeMode = isOwner && prefs.mode === 'employee';
  const desktopRevenueLayout = desktopLayout && permissions.viewRevenue && !employeeMode && desktopLeftPanel != null;

  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const update = () => setDesktopLayout(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const unlock = () => primeSaveChime();
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const lastLocation = useRef(fullLocation);
  const lastPath = useRef(location);
  const routeHistory = useRef<string[]>([fullLocation]);
  useEffect(() => {
    if (lastLocation.current === fullLocation) return;
    const existingIndex = routeHistory.current.lastIndexOf(fullLocation);
    if (existingIndex >= 0) routeHistory.current.length = existingIndex + 1;
    else routeHistory.current.push(fullLocation);
    lastLocation.current = fullLocation;
    if (lastPath.current === location) return;
    lastPath.current = location;
    if (location === '/' || location === '/attendance') setQuery('');
    requestAnimationFrame(() => {
      const main = document.getElementById('main');
      if (location === '/' || location === '/attendance') main?.scrollTo(0, 0);
      const target = main?.querySelector<HTMLElement>('h1, h2') ?? main;
      if (target && target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.tabIndex = -1;
      target?.focus({ preventScroll: false });
    });
  }, [fullLocation, location]);

  function goBack() {
    setQuery('');
    if (routeHistory.current.length > 1) {
      routeHistory.current.pop();
      navigate(routeHistory.current[routeHistory.current.length - 1], { replace: true });
    } else navigate(homeHref, { replace: true });
  }
  function applyView(next: ViewPrefs) {
    setNotice('');
    setError('');
    setQuery('');
    setPrefs(next);
  }
  function updatePrintPreferences(next: PrintPreferences) {
    setPrintPreferences(next);
    writePrintPreferences(userId, next);
  }

  const shortcutActions = useMemo<KeyboardShortcutAction[]>(() => {
    const actions: KeyboardShortcutAction[] = [
      { id: 'home', label: 'Mở trang chính', group: 'Điều hướng chung', run: () => navigate(homeHref) },
      { id: 'personal', label: 'Mở chấm công cá nhân', group: 'Điều hướng chung', run: () => navigate('/personal') },
      { id: 'search', label: 'Đưa tiêu điểm đến tìm kiếm', group: 'Điều hướng chung', run: () => document.getElementById('global-search')?.focus() },
      { id: 'settings', label: 'Mở cài đặt', group: 'Điều hướng chung', run: () => setSettingsOpen(true) },
      { id: 'back', label: 'Trở về', group: 'Điều hướng chung', run: goBack },
    ];
    if (location !== '/personal') actions.push({
        id: 'save-active-form',
        label: 'Lưu biểu mẫu đang mở',
        group: 'Biểu mẫu',
        allowInDialog: true,
        allowWhenEditing: true,
        run: submitActiveDialogForm,
    });
    if (canViewEmployees) actions.push({ id: 'employees', label: 'Quản lý nhân viên', group: 'Điều hướng chung', run: () => navigate(withHistory('/employees')) });
    if (permissions.viewCards) actions.push({ id: 'cards', label: 'Quản lý thẻ', group: 'Điều hướng chung', run: () => navigate('/cards') });
    if (permissions.viewAppointments || permissions.editAppointments) {
      actions.push({ id: 'appointments', label: 'Lịch hẹn và trạng thái', group: 'Điều hướng chung', run: () => navigate('/appointments') });
    }
    if (permissions.editAppointments && !historyMonth) {
      actions.push({
        id: 'new-appointment',
        label: 'Thêm lịch hẹn',
        group: 'Thao tác nhanh',
        run: () => navigate('/appointments?shortcutAction=new-appointment'),
      });
    }
    if (canAddEmployees) {
      actions.push({
        id: 'new-employee',
        label: 'Thêm nhân viên',
        group: 'Thao tác nhanh',
        run: () => navigate('/employees?shortcutAction=new-employee'),
      });
    }
    if (canEditCards) {
      actions.push({
        id: 'new-card',
        label: 'Bán thẻ mới',
        group: 'Thao tác nhanh',
        run: () => navigate('/cards?shortcutAction=new-card'),
      });
    }
    if (canEditEmployees) {
      for (const member of members) {
        actions.push({
          id: `attendance-${member.id}`,
          label: `Chấm công cho ${member.name}`,
          group: 'Chấm công theo nhân viên',
          run: () => navigate(`/employees?shortcutAttendance=${encodeURIComponent(String(member.id))}`),
        });
      }
    }
    if (permissions.editServices) actions.push({ id: 'services', label: 'Dịch vụ và giá', group: 'Điều hướng chung', run: () => navigate('/services') });
    if (canEditServices) {
      actions.push({
        id: 'new-facility-service',
        label: 'Thêm dịch vụ cơ sở',
        group: 'Thao tác nhanh',
        run: () => navigate('/services?shortcutAction=new-service'),
      });
    }
    return actions;
  }, [canAddEmployees, canEditCards, canEditEmployees, canEditServices, canViewEmployees, goBack, historyMonth, homeHref, location, members, navigate, permissions.editServices, permissions.editAppointments, permissions.viewAppointments, permissions.viewCards, withHistory]);

  useDeviceKeyboardShortcuts(shortcutActions);

  const ctx: ShellCtx = {
    canEdit: canEditEmployees,
    isOwner,
    permissions,
    canViewEmployees,
    canEditEmployees,
    canAddEmployees,
    canDeleteEmployees: canViewEmployees && permissions.deleteEmployees && !historyMonth,
    canEditCards,
    canEditServices,
    historyMonth,
    selectedHistoryDate,
    period: { month: resolved.month, date: resolved.date, currentMonth: resolved.currentMonth, today },
    withHistory,
    employeeMode,
    prefs,
    members,
    membersLoading: canViewEmployees && membersQuery.isLoading,
    membersError: membersQuery.isError,
    retryMembers: () => void membersQuery.refetch(),
    query,
    setQuery,
    desktopLayout,
    notify: (message) => { setError(''); setNotice(message); },
    fail: (err) => { setNotice(''); setError(errorText(err)); },
    clearMessages: () => { setError(''); setNotice(''); },
    openSettings: () => setSettingsOpen(true),
    setView: applyView,
    printPreferences,
    updatePrintPreferences,
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className={desktopRevenueLayout ? 'app desktop-revenue-layout' : 'app'}>
        <a className="skip-link" href="#main" data-testid="link-skip-main">Bỏ qua đến nội dung chính</a>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href={homeHref} onClick={() => setQuery('')} className="brand" data-testid="link-home">
              <span className="brand-mark"><Hand size={15} strokeWidth={2.4} aria-hidden="true" /></span><span>SỔ CÔNG</span>
            </Link>
            <form role="search" className="search" onSubmit={(event) => event.preventDefault()}>
              <Search size={16} aria-hidden="true" />
              <label htmlFor="global-search" className="sr-only">Tìm kiếm</label>
              <input id="global-search" type="search" value={query}
                onChange={(event) => setQuery(event.target.value)} autoComplete="off"
                data-testid="input-global-search"
                placeholder={historyMonth ? 'Tìm nhân viên, ca dịch vụ trong tháng...' : employeeMode ? 'Tìm khách, dịch vụ trong tháng...' : permissions.viewCards && canViewEmployees ? 'Tìm nhân viên, khách, số điện thoại, dịch vụ...' : permissions.viewCards ? 'Tìm khách, số điện thoại...' : 'Tìm nhân viên, khách, dịch vụ...'} />
              {query && <button type="button" className="icon-btn" onClick={() => setQuery('')}
                aria-label="Xóa tìm kiếm" data-testid="button-clear-search"><X size={15} /></button>}
            </form>
            <div className="account">
              {employeeMode && <span className="mode-pill" data-testid="status-view-mode">Xem NV cơ sở · chỉ xem</span>}
              <span className={isOwner ? 'mode-pill' : 'mode-pill guest-pill'} data-testid={isOwner ? 'status-owner-role' : 'status-manager-role'}>{isOwner ? 'Chủ sở hữu' : 'Quản lý được cấp quyền'}</span>
              {businessSwitcher}
              <button type="button" className="link-soft as-button" onClick={onSignOut} data-testid="button-sign-out">Đăng xuất</button>
              <ViewSettings prefs={prefs} members={members}
                open={settingsOpen} onOpenChange={setSettingsOpen} onApply={applyView}
                isOwner={isOwner} permissions={permissions}
                canManageGrants={isOwner || hasFacilityAccess(permissions)}
                homeHref={homeHref}
                shortcutActions={shortcutActions}
                printPreferences={printPreferences}
                onPrintPreferencesChange={updatePrintPreferences} />
            </div>
          </div>
        </header>
        {desktopRevenueLayout && (
          <aside className="desktop-revenue-panel" aria-label="Doanh thu cơ sở">
            {desktopLeftPanel}
          </aside>
        )}
        <aside className="desktop-rail" aria-label="Điều hướng chính">
          <nav className="desktop-rail-nav">
            <Link href={homeHref} onClick={() => setQuery('')} className="desktop-nav-link" aria-current={location === '/' || location === '/attendance' ? 'page' : undefined} data-testid="desktop-link-home">
              <Home size={17} aria-hidden="true" /><span>Trang chính</span>
            </Link>
            {canViewEmployees && <Link href={withHistory('/employees')} className="desktop-nav-link" aria-current={employeeRoute ? 'page' : undefined} data-testid="desktop-link-employees">
              <Users size={17} aria-hidden="true" /><span>Quản lý nhân viên</span>
            </Link>}
            {permissions.viewCards && <Link href="/cards" className="desktop-nav-link" aria-current={location.startsWith('/cards') ? 'page' : undefined} data-testid="desktop-link-cards">
              <CreditCard size={17} aria-hidden="true" /><span>Quản lý thẻ</span>
            </Link>}
            {(permissions.viewAppointments || permissions.editAppointments) && <Link href="/appointments" className="desktop-nav-link" aria-current={location === '/appointments' ? 'page' : undefined} data-testid="desktop-link-appointments">
              <CalendarDays size={17} aria-hidden="true" /><span>Lịch hẹn và trạng thái</span>
            </Link>}
            {permissions.editServices && <Link href="/services" className="desktop-nav-link" aria-current={location === '/services' ? 'page' : undefined} data-testid="desktop-link-services">
              <Sparkles size={17} aria-hidden="true" /><span>Dịch vụ &amp; giá</span>
            </Link>}
          </nav>
          <div className="desktop-rail-bottom">
            <Link href="/personal" className="desktop-nav-link personal-nav-link" aria-current={location === '/personal' ? 'page' : undefined} data-testid="desktop-link-personal">
              <BookHeart size={17} aria-hidden="true" /><span>Chấm công cá nhân</span>
            </Link>
          </div>
        </aside>
        <main className="main" id="main" aria-label="Nội dung chính" tabIndex={-1}>
          {authStatusMessage && <div className="banner danger" role="status">{authStatusMessage}</div>}
          {historyMonth && employeeRoute && (
            <div className="banner soft history-banner" role="status" data-testid="status-history-mode">
              <History size={15} aria-hidden="true" />
              <span><strong>Lịch sử {formatMonth(historyMonth).toLowerCase()}</strong> · chỉ xem.</span>
              <label className="history-month">
                <span className="sr-only">Chọn tháng lịch sử</span>
                <input type="month" value={historyMonth} max={resolved.currentMonth} data-testid="input-history-month"
                  onChange={(e) => { const v = e.target.value; if (!v) return; navigate(v >= resolved.currentMonth ? location : `${location}?month=${v}`); }} />
              </label>
              <Link href={location} className="link-strong" data-testid="link-exit-history">Về dữ liệu hiện tại</Link>
            </div>
          )}
          {showResults && <SearchResults />}
          {error && <div className="banner danger" role="alert" data-testid="status-mutation-error">
            <AlertCircle size={15} aria-hidden="true" /><span>{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Đóng thông báo lỗi"><X size={14} /></button>
          </div>}
          {notice && <div className="banner success" role="status" data-testid="status-success">
            <Check size={15} aria-hidden="true" /><span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={14} /></button>
          </div>}
          {employeeMode ? employeeView : children}
          {(showResults || (location !== '/' && location !== '/attendance')) && (
            <nav className="screen-nav" aria-label="Điều hướng trang">
              <Link href={homeHref} onClick={() => setQuery('')} className="btn ghost nav-home-action" data-testid="link-return-home">
                <Home size={15} aria-hidden="true" />Trang chính
              </Link>
              <button type="button" className="btn ghost nav-return-action" onClick={goBack} data-testid="button-return-previous">
                <ArrowLeft size={15} aria-hidden="true" />Trở về
              </button>
            </nav>
          )}
        </main>
      </div>
    </Ctx.Provider>
  );
}
