import { useCallback, useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { FacilityPermissions, MemberRecord } from '@workspace/api-client-react';
import { ArrowLeft, BookHeart, ChevronRight, History, Home, KeyRound, Palette, Settings, Trash2, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { HistoryMonthsDialog } from '@/components/history-months-dialog';
import { HistoryDeleteDialog } from '@/components/history-delete-dialog';
import { AccessGrantsDialog } from '@/components/access-grants';
import { useColorTheme, type AppColorTheme } from '@/components/color-theme-provider';
import { ColorPaletteControls } from '@/components/color-palette-controls';

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { theme, setTheme, colors, setColor, resetColors } = useColorTheme();
  const editThemeColors = (nextTheme: AppColorTheme) => {
    setTheme(nextTheme);
    setPaletteOpen(true);
  };
  const themeName = theme === 'default' ? 'Vàng sa mạc' : theme === 'dark' ? 'Tối nâu' : 'Tùy chỉnh';

  useEffect(() => {
    if (!open) setPaletteOpen(false);
  }, [open]);

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
        <DialogPrimitive.Content className={`settings-dialog${paletteOpen ? ' palette-mode' : ''}`} data-testid={paletteOpen ? 'dialog-color-palette' : 'dialog-view-settings'}>
          <div className="dialog-head">
            {paletteOpen && <button type="button" className="icon-btn" onClick={() => setPaletteOpen(false)} aria-label="Trở về cài đặt" data-testid="button-back-from-color-palette"><ArrowLeft size={18} /></button>}
            <DialogPrimitive.Title asChild><h2>{paletteOpen ? `Bảng màu · ${themeName}` : 'Cài đặt'}</h2></DialogPrimitive.Title>
            <DialogPrimitive.Close asChild><button type="button" className="icon-btn" aria-label={paletteOpen ? 'Đóng bảng màu' : 'Đóng cài đặt'}><X size={18} /></button></DialogPrimitive.Close>
          </div>
          {paletteOpen ? (
            <>
              <DialogPrimitive.Description className="sub">Chỉ chỉnh giao diện đang chọn; hai giao diện còn lại không bị thay đổi.</DialogPrimitive.Description>
              <ColorPaletteControls colors={colors} onChange={setColor} onReset={resetColors} />
            </>
          ) : (
          <>
          <DialogPrimitive.Description className="sub">
            {isOwner ? 'Lịch sử, cấp quyền quản lý và sổ cá nhân.' : canManageGrants ? 'Lịch sử tháng, quyền quản lý trong phạm vi được cấp và sổ cá nhân.' : 'Lịch sử tháng và sổ cá nhân.'}
          </DialogPrimitive.Description>

          <section className="theme-settings" aria-labelledby="theme-settings-title">
            <h3 id="theme-settings-title">Giao diện</h3>
            <fieldset className="theme-options">
              <legend>Chọn màu nền</legend>
              <div className="theme-option-row">
                <label className={`theme-option${theme === 'default' ? ' selected' : ''}`}>
                  <input type="radio" name="app-color-theme" value="default" checked={theme === 'default'}
                    onChange={() => setTheme('default')} data-testid="radio-theme-default" />
                  <span className="theme-swatch theme-swatch-default" aria-hidden="true" />
                  <span className="theme-option-copy">
                    <strong>Vàng sa mạc</strong>
                    <span>Nền vàng, khung nội dung trắng</span>
                  </span>
                </label>
                <button type="button" className="theme-edit-button" onClick={() => editThemeColors('default')}
                  aria-label="Sửa màu giao diện Vàng sa mạc" data-testid="button-edit-theme-default">Sửa màu</button>
              </div>
              <div className="theme-option-row">
                <label className={`theme-option${theme === 'dark' ? ' selected' : ''}`}>
                  <input type="radio" name="app-color-theme" value="dark" checked={theme === 'dark'}
                    onChange={() => setTheme('dark')} data-testid="radio-theme-dark" />
                  <span className="theme-swatch theme-swatch-dark" aria-hidden="true" />
                  <span className="theme-option-copy">
                    <strong>Tối nâu</strong>
                    <span>Nền và khung tông nâu đậm</span>
                  </span>
                </label>
                <button type="button" className="theme-edit-button" onClick={() => editThemeColors('dark')}
                  aria-label="Sửa màu giao diện tối nâu" data-testid="button-edit-theme-dark">Sửa màu</button>
              </div>
              <div className="theme-option-row">
                <label className={`theme-option${theme === 'custom' ? ' selected' : ''}`}>
                  <input type="radio" name="app-color-theme" value="custom" checked={theme === 'custom'}
                    onChange={() => setTheme('custom')} data-testid="radio-theme-custom" />
                  <span className="theme-swatch theme-swatch-custom" aria-hidden="true" />
                  <span className="theme-option-copy">
                    <strong>Tùy chỉnh</strong>
                    <span>Giao diện riêng, không đổi hai giao diện mặc định</span>
                  </span>
                </label>
                <button type="button" className="theme-edit-button" onClick={() => editThemeColors('custom')}
                  aria-label="Sửa màu giao diện tùy chỉnh" data-testid="button-edit-theme-custom">Sửa màu</button>
              </div>
            </fieldset>
          </section>

          <button type="button" className="settings-link" onClick={() => editThemeColors('custom')} data-testid="button-open-color-palette">
            <Palette size={16} aria-hidden="true" /><span className="grow"><strong>Chỉnh màu giao diện</strong><span className="muted">Tùy chỉnh màu nền, chữ, khung và trạng thái</span></span><ChevronRight size={16} aria-hidden="true" />
          </button>

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
          </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
    {historyOpen && <HistoryMonthsDialog listOnly onPick={pickHistory} onClose={() => setHistoryOpen(false)} />}
    {deleteHistoryOpen && isOwner && <HistoryDeleteDialog onClose={() => setDeleteHistoryOpen(false)} />}
    {grantsOpen && canManageGrants && <AccessGrantsDialog members={members} isOwner={isOwner} permissions={permissions} onClose={() => setGrantsOpen(false)} />}
    </>
  );
}
