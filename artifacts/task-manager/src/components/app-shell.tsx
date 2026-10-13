import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetCurrentAccessQueryKey, getListMembersQueryKey, useGetCurrentAccess, useListMembers } from '@workspace/api-client-react';
import type { AccessStatus, MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, ArrowUpRight, Check, Eye, Hand, LoaderCircle, LockKeyhole, Search, ShieldCheck, X } from 'lucide-react';
import { Link } from 'wouter';
import { ViewSettings, useViewPrefs, type ViewPrefs } from '@/components/view-settings';
import { statusCode } from '@/lib/attendance';
import { errorText } from '@/lib/massage';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

type ShellCtx = {
  access: AccessStatus | undefined;
  accessLoading: boolean;
  isOwner: boolean;
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
};

const Ctx = createContext<ShellCtx | null>(null);
export function useShell() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell outside AppShell');
  return v;
}

export function AppShell({ children, employeeView }: { children: ReactNode; employeeView: ReactNode }) {
  const cache = useQueryClient();
  const accessQuery = useGetCurrentAccess({ query: { queryKey: getGetCurrentAccessQueryKey(), retry: false } });
  const access = accessQuery.data;
  const isOwner = access?.isOwner === true;
  const [prefs, setPrefs] = useViewPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const employeeMode = prefs.mode === 'employee';
  const canEdit = isOwner && prefs.mode === 'owner';
  const membersQuery = useListMembers({ query: { queryKey: getListMembersQueryKey() } });
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const ctx: ShellCtx = {
    access, accessLoading: accessQuery.isLoading, isOwner, canEdit, employeeMode, prefs, members,
    membersLoading: membersQuery.isLoading, membersError: membersQuery.isError, retryMembers: () => void membersQuery.refetch(),
    query, setQuery,
    notify: (m) => { setError(''); setNotice(m); },
    fail: (err) => {
      setNotice('');
      setError(errorText(err));
      const s = statusCode(err);
      if (s === 401 || s === 403) {
        cache.setQueryData(getGetCurrentAccessQueryKey(), { signedIn: access?.signedIn ?? false, isOwner: false, ownerConfigured: access?.ownerConfigured ?? false });
        void cache.invalidateQueries({ queryKey: getGetCurrentAccessQueryKey() });
      }
    },
    clearMessages: () => { setError(''); setNotice(''); },
    openSettings: () => setSettingsOpen(true),
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
            <Link href="/" className="brand" data-testid="link-home"><span className="brand-mark"><Hand size={15} strokeWidth={2.4} /></span><span>Số công</span></Link>
            <form role="search" className="search" onSubmit={(e) => e.preventDefault()}>
              <Search size={16} aria-hidden="true" />
              <label htmlFor="global-search" className="sr-only">Tìm kiếm</label>
              <input id="global-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" data-testid="input-global-search"
                placeholder={employeeMode ? 'Tìm khách, dịch vụ, ghi chú trong tháng...' : 'Tìm nhân viên, khách, số điện thoại, dịch vụ...'} />
              {query && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm" data-testid="button-clear-search"><X size={15} /></button>}
            </form>
            <div className="account">
              <span className="mode-pill" data-testid="status-view-mode">{employeeMode ? 'Nhân viên' : 'Chủ'}</span>
              <span className={`access ${isOwner ? 'owner' : ''}`} data-testid="status-access">
                {accessQuery.isLoading ? <LoaderCircle className="spin" size={13} /> : isOwner ? <ShieldCheck size={14} /> : <Eye size={14} />}
                <span className="access-text">{accessQuery.isLoading ? 'Đang kiểm tra' : isOwner ? 'Chủ sở hữu' : 'Chỉ xem'}</span>
              </span>
              {access?.signedIn ? <SignOutButton /> : !accessQuery.isLoading && (
                <>
                  <Link href="/sign-in" className="link-strong" data-testid="link-owner-signin">Đăng nhập <ArrowUpRight size={13} /></Link>
                  {access?.ownerConfigured && <Link href="/sign-up" className="link-soft" data-testid="link-owner-signup">Tạo tài khoản</Link>}
                </>
              )}
              <ViewSettings prefs={prefs} members={members} membersLoading={membersQuery.isLoading} open={settingsOpen} onOpenChange={setSettingsOpen} onApply={applyView} />
            </div>
          </div>
        </header>
        <main className="main" id="main">
          {!accessQuery.isLoading && access?.ownerConfigured === false && (
            <div className="banner soft" role="status" data-testid="status-owner-setup"><LockKeyhole size={15} /><span>Chưa cấu hình chủ sở hữu. Mọi thay đổi đang bị khóa.</span></div>
          )}
          {!accessQuery.isLoading && accessQuery.isError && statusCode(accessQuery.error) !== 401 && statusCode(accessQuery.error) !== 403 && (
            <div className="banner danger" role="alert" data-testid="status-access-error"><AlertCircle size={15} /><span>Không thể xác minh quyền. Thao tác chỉnh sửa đang được khóa.</span><button type="button" onClick={() => void accessQuery.refetch()}>Thử lại</button></div>
          )}
          {!employeeMode && !canEdit && !accessQuery.isLoading && (
            <div className="banner soft" role="status" data-testid="status-readonly-owner"><Eye size={15} /><span>Đang ở chế độ chỉ xem. Chỉ chủ sở hữu đã đăng nhập mới chỉnh sửa được.</span></div>
          )}
          {error && <div className="banner danger" role="alert" data-testid="status-mutation-error"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Đóng thông báo lỗi"><X size={14} /></button></div>}
          {notice && <div className="banner success" role="status" data-testid="status-success"><Check size={15} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={14} /></button></div>}
          {employeeMode ? employeeView : children}
        </main>
        <footer className="footer"><span>Số công · tiệm massage</span><span>Lương = giờ phục vụ × giá dịch vụ · Doanh thu = tiền bán thẻ</span></footer>
      </div>
    </Ctx.Provider>
  );
}

function SignOutButton() {
  const { signOut } = useClerk();
  return <button type="button" className="btn small ghost" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">Đăng xuất</button>;
}
