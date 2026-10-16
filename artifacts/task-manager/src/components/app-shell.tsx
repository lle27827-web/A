import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getListMembersQueryKey, useListMembers } from '@workspace/api-client-react';
import type { MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, Check, Hand, History, Home, Search, X } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { SearchResults } from '@/components/search-results';
import { ViewSettings, useViewPrefs, type ViewPrefs } from '@/components/view-settings';
import { errorText, formatMonth, SESSION_FRESHNESS } from '@/lib/massage';
import { periodHref, resolveRevenuePeriod, vietnamToday } from '@/lib/revenue-period';

type ShellCtx = {
  /** Owner AND not viewing a historical month. */
  canEdit: boolean;
  isOwner: boolean;
  /** YYYY-MM when viewing a past month read-only, else null. */
  historyMonth: string | null;
  selectedHistoryDate: string | null;
  /** Month/date currently selected (current month when not in history). */
  period: { month: string; date: string; currentMonth: string; today: string };
  withHistory: (path: string) => string;
  hasManageAccess: boolean;
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
  authenticated,
  authConfigured,
  authStatusMessage,
  onSignOut,
}: {
  children: ReactNode;
  employeeView: ReactNode;
  isOwner: boolean;
  authenticated: boolean;
  authConfigured: boolean;
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
  const membersQuery = useListMembers(memberParams, { query: { queryKey: getListMembersQueryKey(memberParams), ...SESSION_FRESHNESS } });
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
    canEdit: isOwner && !historyMonth,
    isOwner,
    historyMonth,
    selectedHistoryDate,
    period: { month: resolved.month, date: resolved.date, currentMonth: resolved.currentMonth, today },
    withHistory,
    hasManageAccess: isOwner,
    employeeMode,
    prefs,
    members,
    membersLoading: membersQuery.isLoading,
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
                placeholder={employeeMode ? 'Tìm khách, dịch vụ, ghi chú trong tháng...' : isOwner ? 'Tìm nhân viên, khách, số điện thoại, dịch vụ...' : 'Tìm nhân viên...'} />
              {query && <button type="button" className="icon-btn" onClick={() => setQuery('')}
                aria-label="Xóa tìm kiếm" data-testid="button-clear-search"><X size={15} /></button>}
            </form>
            <div className="account">
              {isOwner ? (
                <>
                  {employeeMode && <span className="mode-pill" data-testid="status-view-mode">Xem NV cơ sở · chỉ xem</span>}
                  <span className="mode-pill" data-testid="status-owner-role">Chủ sở hữu</span>
                  <button type="button" className="link-soft as-button" onClick={onSignOut}>Đăng xuất</button>
                  <ViewSettings prefs={prefs} members={members} membersLoading={membersQuery.isLoading}
                    open={settingsOpen} onOpenChange={setSettingsOpen} onApply={applyView}
                    isOwner authenticated={authenticated} authConfigured={authConfigured} />
                </>
              ) : (
                <>
                  <span className="mode-pill guest-pill" data-testid="status-guest-role">
                    {authenticated ? 'Chỉ xem' : 'Khách · chỉ xem'}
                  </span>
                  {authenticated ? (
                    <button type="button" className="link-soft as-button" onClick={onSignOut}>Đăng xuất</button>
                  ) : authConfigured ? (
                    <Link href="/sign-in" className="link-strong" data-testid="link-owner-sign-in">Đăng nhập</Link>
                  ) : (
                    <span className="link-soft" title="Cần cấu hình Clerk bên ngoài trong Replit và Vercel.">
                      Đăng nhập chưa cấu hình
                    </span>
                  )}
                  <ViewSettings prefs={prefs} members={members} membersLoading={membersQuery.isLoading}
                    open={settingsOpen} onOpenChange={setSettingsOpen} onApply={applyView}
                    isOwner={false} authenticated={authenticated} authConfigured={authConfigured} />
                </>
              )}
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
        <footer className="footer">
          <span>SỔ CÔNG · tiệm massage</span>
          {isOwner && <span>Lương tính theo tiền công nhân viên · Doanh thu gồm dịch vụ khách lẻ và tiền bán thẻ; dùng thẻ không cộng doanh thu lần nữa.</span>}
          {!isOwner && <span>Khách chỉ xem được phần quản lý nhân viên.</span>}
        </footer>
      </div>
    </Ctx.Provider>
  );
}
