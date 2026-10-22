import { useCallback, useContext, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { FacilityPermissions, MemberRecord } from '@workspace/api-client-react';
import { ArrowLeft, BookHeart, ChevronRight, History, Home, KeyRound, Settings, Trash2, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { HistoryMonthsDialog } from '@/components/history-months-dialog';
import { HistoryDeleteDialog } from '@/components/history-delete-dialog';
import { AccessGrantsDialog } from '@/components/access-grants';
import { AppGestureContext } from '@/components/app-gesture-context';

export type ViewMode = 'owner' | 'employee';
export type ViewPrefs = { mode: ViewMode; employeeId: number | null };

const KEY = 'cung-lam:view';
const DEFAULT: ViewPrefs = { mode: 'owner', employeeId: null };

function readPrefs(): ViewPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return DEFAULT;
    const o = v as Record<string, unknown>;
    const id = typeof o.employeeId === 'number' && Number.isInteger(o.employeeId) && o.employeeId > 0 ? o.employeeId : null;
    // Retire the old "view as employee" setting while keeping the saved
    // employee selection available for ordinary detail-page navigation.
    return { mode: 'owner', employeeId: id };
  } catch {
    return DEFAULT;
  }
}

export function useViewPrefs() {
  const [prefs, setPrefs] = useState<ViewPrefs>(readPrefs);
  const update = useCallback((next: ViewPrefs) => {
    setPrefs(next);
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep in memory */ }
  }, []);
  return [prefs, update] as const;
}

export function ViewSettings({ prefs, members, open, onOpenChange, onApply, isOwner, permissions, canManageGrants }: {
  prefs: ViewPrefs;
  members: MemberRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (prefs: ViewPrefs) => void;
  isOwner: boolean;
  permissions: FacilityPermissions;
  canManageGrants: boolean;
}) {
  const canViewEmployees = permissions.allEmployees || permissions.employeeIds.length > 0;
  const canHistory = canViewEmployees || permissions.viewRevenue;
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [, navigate] = useLocation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteHistoryOpen, setDeleteHistoryOpen] = useState(false);
  const appGestures = useContext(AppGestureContext);
  if (!appGestures) throw new Error('App gesture settings rendered outside the app gesture provider');

  function pickHistory(month: string, date: string) {
    setHistoryOpen(false);
    onOpenChange(false);
    if (isOwner) onApply({ mode: 'owner', employeeId: prefs.employeeId });
    navigate(`${permissions.viewRevenue ? '/' : '/employees'}?month=${month}&date=${date}`);
  }

  return (
    <>
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger asChild>
        <button type="button" className="gear-btn" aria-label="Cài đặt" data-testid="button-view-settings"><Settings size={18} /></button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="settings-overlay" />
        <DialogPrimitive.Content className="settings-dialog" data-testid="dialog-view-settings">
          <div className="dialog-head">
            <DialogPrimitive.Title asChild><h2>Cài đặt</h2></DialogPrimitive.Title>
            <DialogPrimitive.Close asChild><button type="button" className="icon-btn" aria-label="Đóng cài đặt"><X size={18} /></button></DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sub">
            {isOwner ? 'Lịch sử, cấp quyền quản lý và sổ cá nhân.' : canManageGrants ? 'Lịch sử tháng, quyền quản lý trong phạm vi được cấp và sổ cá nhân.' : 'Lịch sử tháng và sổ cá nhân.'}
          </DialogPrimitive.Description>

          <section className="app-gesture-settings" aria-labelledby="app-gesture-title">
            <h3 id="app-gesture-title">Cử chỉ thao tác</h3>
            <button
              type="button"
              role="switch"
              aria-checked={appGestures.enabled}
              aria-label="Cử chỉ lưu và trở về"
              className={`settings-link app-gesture-setting${appGestures.enabled ? ' is-on' : ''}`}
              onClick={() => appGestures.setEnabled(!appGestures.enabled)}
              data-testid="button-toggle-app-gestures"
            >
              <ArrowLeft size={17} aria-hidden="true" />
              <span className="grow">
                <strong>Cử chỉ lưu và trở về</strong>
                <span className="muted">{appGestures.enabled ? 'Đang bật' : 'Đang tắt'}</span>
              </span>
              <span className="app-gesture-switch-state" aria-hidden="true">{appGestures.enabled ? 'Bật' : 'Tắt'}</span>
            </button>
            <p className="app-gesture-help">
              Vẽ liền một nét lên → phải → trái để lưu biểu mẫu thông thường; trái → phải để trở về. Các lần vuốt thường, chạm và nhập liệu vẫn hoạt động như cũ.
            </p>
          </section>

          <Link href="/personal" className="settings-link personal-entry" onClick={() => onOpenChange(false)} data-testid="link-personal-notebook">
            <BookHeart size={17} aria-hidden="true" /><span className="grow"><strong>Chấm công cá nhân</strong><span className="muted">Sổ riêng của tài khoản bạn</span></span><ChevronRight size={16} aria-hidden="true" />
          </Link>

          {canHistory && (
            <button type="button" className="settings-link" onClick={() => setHistoryOpen(true)} data-testid="button-open-history-months">
              <History size={15} aria-hidden="true" /><span className="grow"><strong>Xem lịch sử tháng</strong><span className="muted">{permissions.viewRevenue ? 'Doanh thu và dữ liệu cơ sở theo tháng' : 'Nhân viên theo tháng'}</span></span><ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          {canManageGrants && (
            <button type="button" className="settings-link" onClick={() => { onOpenChange(false); setGrantsOpen(true); }} data-testid="button-open-access-grants">
              <KeyRound size={15} aria-hidden="true" /><span className="grow"><strong>Cấp quyền quản lý</strong><span className="muted">{isOwner ? 'Danh sách và quyền của nhiều tài khoản' : 'Xem và cấp trong phạm vi quyền của bạn'}</span></span><ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          {isOwner && (
            <button type="button" className="settings-link" onClick={() => { onOpenChange(false); setDeleteHistoryOpen(true); }} data-testid="button-open-delete-history">
              <Trash2 size={15} aria-hidden="true" /><span className="grow"><strong>Xóa lịch sử chấm công</strong><span className="muted">Chọn khoảng ngày cần xóa</span></span><ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          <nav className="window-nav bottom" aria-label="Điều hướng cửa sổ">
            <Link href="/" onClick={() => onOpenChange(false)} className="btn ghost" data-testid="link-settings-home"><Home size={14} aria-hidden="true" />Trang chính</Link>
            <button type="button" className="btn ghost" onClick={() => onOpenChange(false)} data-testid="button-settings-back"><ArrowLeft size={14} aria-hidden="true" />Trở về</button>
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
    {historyOpen && <HistoryMonthsDialog listOnly onPick={pickHistory} onClose={() => setHistoryOpen(false)} />}
    {deleteHistoryOpen && isOwner && <HistoryDeleteDialog onClose={() => setDeleteHistoryOpen(false)} />}
    {grantsOpen && canManageGrants && <AccessGrantsDialog members={members} isOwner={isOwner} permissions={permissions} onClose={() => setGrantsOpen(false)} />}
    </>
  );
}
