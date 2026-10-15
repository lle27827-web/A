import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useListMembers } from '@workspace/api-client-react';
import type { MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, Check, Hand, Home, Search, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { SearchResults } from '@/components/search-results';
import { ViewSettings, useViewPrefs, type ViewPrefs } from '@/components/view-settings';
import { errorText } from '@/lib/massage';

type ShellCtx = {
  canEdit: boolean;
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
  const membersQuery = useListMembers();
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const showResults = query.trim().length > 0;
  const employeeMode = isOwner && prefs.mode === 'employee';

  const lastLocation = useRef(location);
  const routeHistory = useRef<string[]>([location]);
  useEffect(() => {
    if (lastLocation.current === location) return;
    const existingIndex = routeHistory.current.lastIndexOf(location);
    if (existingIndex >= 0) routeHistory.current.length = existingIndex + 1;
    else routeHistory.current.push(location);
    lastLocation.current = location;
    if (location === '/' || location === '/attendance') setQuery('');
    requestAnimationFrame(() => {
      const main = document.getElementById('main');
      const target = main?.querySelector<HTMLElement>('h1, h2') ?? main;
      target?.focus({ preventScroll: false });
    });
  }, [location]);

  function goBack() {
    setQuery('');
    if (routeHistory.current.length > 1) {
      routeHistory.current.pop();
      navigate(routeHistory.current[routeHistory.current.length - 1], { replace: true });
    } else navigate('/', { replace: true });
  }
  function applyView(next: ViewPrefs) {
    setNotice('');
    setError('');
    setQuery('');
    setPrefs(next);
  }

  const ctx: ShellCtx = {
    canEdit: isOwner,
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
            <Link href="/" onClick={() => setQuery('')} className="brand" data-testid="link-home">
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
                  {employeeMode && <span className="mode-pill" data-testid="status-view-mode">Xem nhân viên</span>}
                  <span className="mode-pill" data-testid="status-owner-role">Chủ sở hữu</span>
                  <button type="button" className="link-soft as-button" onClick={onSignOut}>Đăng xuất</button>
                  <ViewSettings prefs={prefs} members={members} membersLoading={membersQuery.isLoading}
                    open={settingsOpen} onOpenChange={setSettingsOpen} onApply={applyView} />
                </>
              ) : (
                <>
                  <span className="mode-pill guest-pill" data-testid="status-guest-role">
                    {authenticated ? 'Chỉ xem' : 'Khách · chỉ xem'}
                  </span>
                  {authenticated ? (
                    <button type="button" className="link-soft as-button" onClick={onSignOut}>Đăng xuất</button>
                  ) : authConfigured ? (
                    <Link href="/sign-in" className="link-strong" data-testid="link-owner-sign-in">Đăng nhập chủ</Link>
                  ) : (
                    <span className="link-soft" title="Cần cấu hình Clerk bên ngoài trong Replit và Vercel.">
                      Đăng nhập chưa cấu hình
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </header>
        <main className="main" id="main">
          {authStatusMessage && <div className="banner danger" role="status">{authStatusMessage}</div>}
          {location !== '/' && location !== '/attendance' && !showResults && (
            <nav className="screen-nav" aria-label="Điều hướng trang">
              <Link href="/" onClick={() => setQuery('')} className="btn ghost" data-testid="link-return-home">
                <Home size={15} aria-hidden="true" />Trở về trang chính
              </Link>
              <button type="button" className="btn ghost" onClick={goBack} data-testid="button-return-previous">
                <ArrowLeft size={15} aria-hidden="true" />Trở về
              </button>
            </nav>
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
        </main>
        <footer className="footer">
          <span>SỔ CÔNG · tiệm massage</span>
          {isOwner && <span>Lương = giờ phục vụ × giá dịch vụ · Doanh thu = tổng lương ca dịch vụ + tiền bán thẻ</span>}
          {!isOwner && <span>Khách chỉ xem được phần quản lý nhân viên.</span>}
        </footer>
      </div>
    </Ctx.Provider>
  );
}
