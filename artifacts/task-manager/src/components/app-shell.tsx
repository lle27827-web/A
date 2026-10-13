import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth, useClerk, useUser } from '@clerk/react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getGetCurrentAccessQueryKey, getListManagersQueryKey, getListMembersQueryKey, getListTreatmentCardsQueryKey, useGetCurrentAccess, useListMembers } from '@workspace/api-client-react';
import type { AccessStatus, MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, Eye, Hand, Home, LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck, ShieldX, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { SearchResults } from '@/components/search-results';
import { ViewSettings, useViewPrefs, type ViewPrefs } from '@/components/view-settings';
import { statusCode } from '@/lib/attendance';
import { errorText } from '@/lib/massage';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

type ShellCtx = {
  access: AccessStatus;
  accessKey: QueryKey;
  accessLoading: boolean;
  isOwner: boolean;
  hasManageAccess: boolean;
  canEdit: boolean;
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
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell outside AppShell');
  return v;
}

const AUTH_BASE = getGetCurrentAccessQueryKey()[0];
function isPrivateKey(key: QueryKey) { return key[0] !== AUTH_BASE; }

export function AppShell({ children, employeeView }: { children: ReactNode; employeeView: ReactNode }) {
  const cache = useQueryClient();
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { user } = useUser();
  const accessKey = useMemo<QueryKey>(() => [...getGetCurrentAccessQueryKey(), userId ?? 'anon', sessionId ?? 'none'], [userId, sessionId]);
  const accessQuery = useGetCurrentAccess({ query: { queryKey: accessKey, enabled: isLoaded, retry: false, staleTime: 15_000, refetchOnWindowFocus: true, refetchInterval: 30_000 } });
  const access = accessQuery.data;
  const canViewMemberData = isLoaded && !!isSignedIn && !accessQuery.isError && access?.signedIn === true;

  // Clear private data on identity switch or once a resolved check shows loss of access.
  const prevScope = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoaded) return;
    const scope = userId ?? 'anon';
    if (prevScope.current !== null && prevScope.current !== scope) cache.removeQueries({ predicate: (q) => isPrivateKey(q.queryKey) });
    prevScope.current = scope;
  }, [isLoaded, userId, cache]);
  const resolved = isLoaded && (accessQuery.isError || access !== undefined) && !accessQuery.isLoading;
  useEffect(() => {
    if (!resolved) return;
    if (!canViewMemberData) { void cache.cancelQueries({ predicate: (q) => isPrivateKey(q.queryKey) }); cache.removeQueries({ predicate: (q) => isPrivateKey(q.queryKey) }); }
    else if (!access?.isOwner) cache.removeQueries({ queryKey: getListManagersQueryKey() });
  }, [resolved, canViewMemberData, access?.isOwner, cache]);

  const email = user?.primaryEmailAddress?.emailAddress ?? user?.username ?? '';
  const checking = !isLoaded || accessQuery.isLoading || (!resolved && accessQuery.isFetching);
  const roleLabel = checking ? 'Đang kiểm tra' : canViewMemberData ? access?.isOwner ? 'Chủ sở hữu' : access?.canManage ? 'Quản lý' : 'Chỉ xem nhân viên' : isSignedIn ? 'Không xác minh được quyền' : 'Chưa đăng nhập';
  const recheck = () => { void user?.reload().catch(() => undefined); void accessQuery.refetch(); };

  if (canViewMemberData && access) return <AuthorizedShell access={access} accessKey={accessKey} email={email} roleLabel={roleLabel} recheck={recheck} rechecking={accessQuery.isFetching} employeeView={employeeView}>{children}</AuthorizedShell>;

  const status = accessQuery.isError ? statusCode(accessQuery.error) : 0;
  return (
    <div className="app">
      <header className="topbar"><div className="topbar-inner">
        <Link href="/" className="brand" data-testid="link-home"><span className="brand-mark"><Hand size={15} strokeWidth={2.4} /></span><span>SỔ CÔNG</span></Link>
        <div className="account">
          <RoleBadge label={roleLabel} ok={false} loading={checking} />
          {isSignedIn && <SignOutButton />}
        </div>
      </div></header>
      <main className="main" id="main" tabIndex={-1}>
        <section className="gate panel" aria-labelledby="gate-title" aria-busy={checking} data-testid="section-access-gate">
          {checking ? (
            <><LoaderCircle className="spin" size={26} aria-hidden="true" /><h1 id="gate-title" className="page-title">Đang xác minh quyền</h1><p className="sub">Dữ liệu chỉ hiện sau khi máy chủ xác nhận vai trò của bạn.</p></>
          ) : accessQuery.isError && status !== 401 && status !== 403 ? (
            <><AlertCircle size={26} aria-hidden="true" /><h1 id="gate-title" className="page-title">Không xác minh được quyền</h1><p className="sub">Dữ liệu đang được khóa. Kiểm tra kết nối rồi thử lại.</p>
              <button type="button" className="btn primary" onClick={recheck} data-testid="button-recheck-access"><RefreshCw size={14} />Thử lại</button></>
          ) : !isSignedIn || access?.signedIn !== true ? (
            <><LockKeyhole size={26} aria-hidden="true" /><h1 id="gate-title" className="page-title">Đăng nhập để tiếp tục</h1><p className="sub">Đăng nhập để xem danh sách và hồ sơ nhân viên. Chỉ chủ sở hữu hoặc quản lý được chỉnh sửa dữ liệu.</p>
              <div className="head-actions">
                <Link href="/sign-in" className="btn primary" data-testid="link-owner-signin">Đăng nhập <ArrowUpRight size={14} /></Link>
                {isSignedIn && <button type="button" className="btn" onClick={recheck} data-testid="button-recheck-access"><RefreshCw size={14} />Kiểm tra lại</button>}
              </div></>
          ) : (
            <><ShieldX size={26} aria-hidden="true" /><h1 id="gate-title" className="page-title">Tài khoản chưa được cấp quyền</h1>
              <p className="sub" data-testid="text-account-email">Đang đăng nhập: <strong>{email || 'không rõ email'}</strong></p>
              <p className="sub">{access?.ownerConfigured === false ? 'Chưa cấu hình chủ sở hữu.' : 'Hãy nhờ chủ sở hữu cấp quyền quản lý cho đúng email đã xác minh này, rồi kiểm tra lại.'}</p>
              <div className="head-actions">
                <button type="button" className="btn primary" onClick={recheck} disabled={accessQuery.isFetching} data-testid="button-recheck-access">{accessQuery.isFetching ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}Kiểm tra lại quyền</button>
                <SignOutButton />
              </div></>
          )}
        </section>
      </main>
      <footer className="footer"><span>SỔ CÔNG · tiệm massage</span></footer>
    </div>
  );
}

function RoleBadge({ label, ok, loading }: { label: string; ok: boolean; loading: boolean }) {
  return (
    <span className={`access ${ok ? 'owner' : ''}`} data-testid="status-access" aria-label={`Vai trò: ${label}`}>
      {loading ? <LoaderCircle className="spin" size={13} /> : ok ? <ShieldCheck size={14} /> : <Eye size={14} />}
      <span className="access-role">{label}</span>
    </span>
  );
}

function AuthorizedShell({ access, accessKey, email, roleLabel, recheck, rechecking, children, employeeView }: {
  access: AccessStatus; accessKey: QueryKey; email: string; roleLabel: string; recheck: () => void; rechecking: boolean; children: ReactNode; employeeView: ReactNode;
}) {
  const [location, navigate] = useLocation();
  const cache = useQueryClient();
  const isOwner = access.isOwner === true;
  const hasManageAccess = access.canManage === true;
  const prevManage = useRef(hasManageAccess);
  useEffect(() => {
    if (prevManage.current && !hasManageAccess) {
      const managerOnly = (query: { queryKey: QueryKey }) => isPrivateKey(query.queryKey) && query.queryKey[0] !== getListMembersQueryKey()[0];
      void cache.cancelQueries({ predicate: managerOnly });
      cache.removeQueries({ predicate: managerOnly });
    } else if (!prevManage.current && hasManageAccess) {
      void cache.invalidateQueries({ queryKey: getListTreatmentCardsQueryKey() });
    }
    prevManage.current = hasManageAccess;
  }, [hasManageAccess, cache]);
  const [prefs, setPrefs] = useViewPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const employeeMode = hasManageAccess && prefs.mode === 'employee';
  const canEdit = hasManageAccess && prefs.mode === 'owner';
  const membersQuery = useListMembers({ query: { queryKey: getListMembersQueryKey() } });
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const [query, setQuery] = useState('');
  const showResults = query.trim().length > 0;
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const routePath = location.split('?')[0].replace(/\/+$/, '') || '/';
  const memberDataRoute = routePath === '/employees' || /^\/employees\/\d+$/.test(routePath);
  const restrictedRoute = !hasManageAccess && !memberDataRoute;
  useEffect(() => {
    if (!restrictedRoute) return;
    setQuery('');
    navigate('/employees', { replace: true });
  }, [restrictedRoute, navigate]);
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

  const ctx: ShellCtx = {
    access, accessKey, accessLoading: false, isOwner, hasManageAccess, canEdit, employeeMode, prefs, members,
    membersLoading: membersQuery.isLoading, membersError: membersQuery.isError, retryMembers: () => void membersQuery.refetch(),
    query, setQuery,
    notify: (m) => { setError(''); setNotice(m); },
    fail: (err) => {
      setNotice('');
      setError(errorText(err));
      const s = statusCode(err);
      if (s === 401 || s === 403) {
        cache.setQueryData<AccessStatus>(accessKey, { signedIn: access.signedIn, isOwner: false, canManage: false, ownerConfigured: access.ownerConfigured });
        void cache.invalidateQueries({ queryKey: getGetCurrentAccessQueryKey() });
      }
    },
    clearMessages: () => { setError(''); setNotice(''); },
    openSettings: () => setSettingsOpen(true),
    setView: (next) => applyView(next),
  };

  function applyView(next: ViewPrefs) {
    setNotice(''); setError(''); setQuery('');
    setPrefs(next);
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" onClick={() => setQuery('')} className="brand" data-testid="link-home"><span className="brand-mark"><Hand size={15} strokeWidth={2.4} /></span><span>SỔ CÔNG</span></Link>
            <form role="search" className="search" onSubmit={(e) => e.preventDefault()}>
              <Search size={16} aria-hidden="true" />
              <label htmlFor="global-search" className="sr-only">Tìm kiếm</label>
              <input id="global-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" data-testid="input-global-search"
                placeholder={!hasManageAccess ? 'Tìm nhân viên...' : employeeMode ? 'Tìm khách, dịch vụ, ghi chú trong tháng...' : 'Tìm nhân viên, khách, số điện thoại, dịch vụ...'} />
              {query && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm" data-testid="button-clear-search"><X size={15} /></button>}
            </form>
            <div className="account">
              <RoleBadge label={roleLabel} ok={hasManageAccess} loading={false} />
              {employeeMode && <span className="mode-pill" data-testid="status-view-mode">Xem nhân viên</span>}
              <span className="account-email" title={email} data-testid="text-account-email">{email}</span>
              <button type="button" className="icon-btn" onClick={recheck} disabled={rechecking} aria-label="Kiểm tra lại danh tính và quyền" title="Kiểm tra lại quyền" data-testid="button-recheck-access">
                <RefreshCw size={15} className={rechecking ? 'spin' : undefined} />
              </button>
              <SignOutButton />
              {hasManageAccess && <ViewSettings prefs={prefs} members={members} membersLoading={membersQuery.isLoading} isOwner={isOwner} canEdit={canEdit} onAuthError={ctx.fail} open={settingsOpen} onOpenChange={setSettingsOpen} onApply={applyView} />}
            </div>
          </div>
        </header>
        <main className="main" id="main">
          {location !== '/' && location !== '/attendance' && !showResults && (
            <nav className="screen-nav" aria-label="Điều hướng trang">
              <Link href="/" onClick={() => setQuery('')} className="btn ghost" data-testid="link-return-home"><Home size={15} aria-hidden="true" />Trở về trang chính</Link>
              <button type="button" className="btn ghost" onClick={goBack} data-testid="button-return-previous"><ArrowLeft size={15} aria-hidden="true" />Trở về</button>
            </nav>
          )}
          {showResults && <SearchResults />}
          {error && <div className="banner danger" role="alert" data-testid="status-mutation-error"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Đóng thông báo lỗi"><X size={14} /></button></div>}
          {notice && <div className="banner success" role="status" data-testid="status-success"><Check size={15} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={14} /></button></div>}
          {restrictedRoute ? <p className="panel page" role="status">Đang mở danh sách nhân viên…</p> : employeeMode ? employeeView : children}
        </main>
        <footer className="footer"><span>SỔ CÔNG · tiệm massage</span><span>Lương = giờ phục vụ × giá dịch vụ · Doanh thu = tổng lương ca dịch vụ + tiền bán thẻ</span></footer>
      </div>
    </Ctx.Provider>
  );
}

function SignOutButton() {
  const { signOut } = useClerk();
  return <button type="button" className="btn small ghost" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">Đăng xuất</button>;
}
