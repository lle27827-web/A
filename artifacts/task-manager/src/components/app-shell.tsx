import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getListMembersQueryKey, useListMembers } from '@workspace/api-client-react';
import type { FacilityPermissions, MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, Check, Hand, History, Home, Search, X } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { SearchResults } from '@/components/search-results';
import { ViewSettings, useViewPrefs, type ViewPrefs } from '@/components/view-settings';
import { errorText, formatMonth, SESSION_FRESHNESS } from '@/lib/massage';
import { periodHref, resolveRevenuePeriod, vietnamToday } from '@/lib/revenue-period';

export const NO_PERMISSIONS: FacilityPermissions = {
  allEmployees: false, employeeIds: [], viewCards: false, viewRevenue: false,
  editEmployees: false, editCards: false, editServices: false,
};
export const ALL_PERMISSIONS: FacilityPermissions = {
  allEmployees: true, employeeIds: [], viewCards: true, viewRevenue: true,
  editEmployees: true, editCards: true, editServices: true,
};
export function hasFacilityAccess(p: FacilityPermissions): boolean {
  return p.allEmployees || p.employeeIds.length > 0 || p.viewCards || p.viewRevenue || p.editServices;
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
  notify: (msg: string) => void;
  fail: (err: unknown) => void;
  clearMessages: () => void;
  openSettings: () => void;
  setView: (next: ViewPrefs) => void;
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
  isOwner,
  permissions,
  authStatusMessage,
  onSignOut,
}: {
  children: ReactNode;
  employeeView: ReactNode;
  isOwner: boolean;
  permissions: FacilityPermissions;
  authStatusMessage?: string;
  onSignOut?: () => void;
}) {
  const [location, navigate] = useLocation();
  const [prefs, setPrefs] = useViewPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const search = useSearch();
  const today = useMemo(() => vietnamToday(), []);
  const resolved = resolveRevenuePeriod(search, today);
  const historyMonth = resolved.month < resolved.currentMonth ? resolved.month : null;
  const selectedHistoryDate = historyMonth ? resolved.date : null;
  const withHistory = (path: string) => periodHref(path, historyMonth, selectedHistoryDate);
  const memberParams = useMemo(() => (historyMonth ? { month: historyMonth } : undefined), [historyMonth]);
  const canViewEmployees = permissions.allEmployees || permissions.employeeIds.length > 0;
  const membersQuery = useListMembers(memberParams, { query: { queryKey: getListMembersQueryKey(memberParams), enabled: canViewEmployees, ...SESSION_FRESHNESS } });
  const fullLocation = search ? `${location}?${search}` : location;
  const employeeRoute = /^\/employees(?:\/|$)/.test(location);
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const showResults = query.trim().length > 0;
  const employeeMode = isOwner && prefs.mode === 'employee';

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
      const target = main?.querySelector<HTMLElement>('h1, h2') ?? main;
      target?.focus({ preventScroll: false });
    });
  }, [fullLocation, location]);

  function goBack() {
    setQuery('');
    if (routeHistory.current.length > 1) {
      routeHistory.current.pop();
      navigate(routeHistory.current[routeHistory.current.length - 1], { replace: true });
    } else navigate(withHistory('/'), { replace: true });
  }
  function applyView(next: ViewPrefs) {
    setNotice('');
    setError('');
    setQuery('');
    setPrefs(next);
  }

  const ctx: ShellCtx = {
    canEdit: canViewEmployees && permissions.editEmployees && !historyMonth,
    isOwner,
    permissions,
    canViewEmployees,
    canEditEmployees: canViewEmployees && permissions.editEmployees && !historyMonth,
    canAddEmployees: permissions.allEmployees && permissions.editEmployees && !historyMonth,
    canEditCards: permissions.viewCards && permissions.editCards && !historyMonth,
    canEditServices: permissions.editServices && !historyMonth,
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
    notify: (message) => { setError(''); setNotice(message); },
    fail: (err) => { setNotice(''); setError(errorText(err)); },
    clearMessages: () => { setError(''); setNotice(''); },
    openSettings: () => setSettingsOpen(true),
    setView: applyView,
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <div className="topbar-inner">
            <Link href={withHistory('/')} onClick={() => setQuery('')} className="brand" data-testid="link-home">
              <span className="brand-mark"><Hand size={15} strokeWidth={2.4} /></span><span>SỔ CÔNG</span>
            </Link>
            <form role="search" className="search" onSubmit={(event) => event.preventDefault()}>
              <Search size={16} aria-hidden="true" />
              <label htmlFor="global-search" className="sr-only">Tìm kiếm</label>
              <input id="global-search" type="search" value={query}
                onChange={(event) => setQuery(event.target.value)} autoComplete="off"
                data-testid="input-global-search"
                placeholder={employeeMode ? 'Tìm khách, dịch vụ, ghi chú trong tháng...' : permissions.viewCards && canViewEmployees ? 'Tìm nhân viên, khách, số điện thoại, dịch vụ...' : permissions.viewCards ? 'Tìm khách, số điện thoại...' : 'Tìm nhân viên, khách, dịch vụ...'} />
              {query && <button type="button" className="icon-btn" onClick={() => setQuery('')}
                aria-label="Xóa tìm kiếm" data-testid="button-clear-search"><X size={15} /></button>}
            </form>
            <div className="account">
              {employeeMode && <span className="mode-pill" data-testid="status-view-mode">Xem NV cơ sở · chỉ xem</span>}
              <span className={isOwner ? 'mode-pill' : 'mode-pill guest-pill'} data-testid={isOwner ? 'status-owner-role' : 'status-manager-role'}>{isOwner ? 'Chủ sở hữu' : 'Quản lý được cấp quyền'}</span>
              <button type="button" className="link-soft as-button" onClick={onSignOut} data-testid="button-sign-out">Đăng xuất</button>
              <ViewSettings prefs={prefs} members={members} membersLoading={membersQuery.isLoading}
                open={settingsOpen} onOpenChange={setSettingsOpen} onApply={applyView}
                isOwner={isOwner} permissions={permissions} />
            </div>
          </div>
        </header>
        <main className="main" id="main">
          {authStatusMessage && <div className="banner danger" role="status">{authStatusMessage}</div>}
          {historyMonth && employeeRoute && (
            <div className="banner soft history-banner" role="status" data-testid="status-history-mode">
              <History size={15} aria-hidden="true" />
              <span><strong>Lịch sử {formatMonth(historyMonth).toLowerCase()}</strong> · chỉ xem, không thể thêm, sửa hay xóa.</span>
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
            <AlertCircle size={15} /><span>{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Đóng thông báo lỗi"><X size={14} /></button>
          </div>}
          {notice && <div className="banner success" role="status" data-testid="status-success">
            <Check size={15} /><span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={14} /></button>
          </div>}
          {employeeMode ? employeeView : children}
          {(showResults || (location !== '/' && location !== '/attendance')) && (
            <nav className="screen-nav" aria-label="Điều hướng trang">
              <Link href={withHistory('/')} onClick={() => setQuery('')} className="btn ghost" data-testid="link-return-home">
                <Home size={15} aria-hidden="true" />Trở về trang chính
              </Link>
              <button type="button" className="btn ghost" onClick={goBack} data-testid="button-return-previous">
                <ArrowLeft size={15} aria-hidden="true" />Trở về
              </button>
            </nav>
          )}
        </main>
      </div>
    </Ctx.Provider>
  );
}
