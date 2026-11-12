import { useCallback, useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { AuthStatus, FacilityPermissions, MemberRecord } from '@workspace/api-client-react';
import { ArrowLeft, BookHeart, Building2, ChevronDown, ChevronRight, CreditCard, History, Home, Keyboard, KeyRound, Menu, Printer, Trash2, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { HistoryMonthsDialog } from '@/components/history-months-dialog';
import { HistoryDeleteDialog } from '@/components/history-delete-dialog';
import { AccessGrantsDialog } from '@/components/access-grants';
import { BusinessAccessSettings } from '@/components/business-access-settings';
import type { BusinessRolePreference } from '@/lib/business-role-preference';
import { MonthlyPayrollPrint } from '@/components/monthly-payroll-print';
import { PrintPreview } from '@/components/print-preview';
import { KeyboardShortcutsSettings } from '@/components/keyboard-shortcuts-settings';
import { PlatformBillingAdmin } from '@/components/platform-billing-admin';
import { AccountEmailSetting } from '@/components/account-email-setting';
import type { KeyboardShortcutAction } from '@/lib/keyboard-shortcuts';
import {
  DEFAULT_PRINT_PREFERENCES,
  PRINT_PAPER_OPTIONS,
  type PrintPreferences,
} from '@/lib/printing';
import './print-settings.css';

export type ViewMode = 'owner' | 'employee';
export type ViewPrefs = { mode: ViewMode; employeeId: number | null };

const KEY_PREFIX = 'cung-lam:view:v2:';
const LEGACY_KEY = 'cung-lam:view';
const DEFAULT: ViewPrefs = { mode: 'owner', employeeId: null };

function viewPrefsKey(userId?: string | null, businessId?: string | null): string {
  return `${KEY_PREFIX}${encodeURIComponent(userId || 'device')}:${encodeURIComponent(businessId || 'personal')}`;
}

function readPrefs(key: string): ViewPrefs {
  try {
    const raw = window.localStorage.getItem(key);
    window.localStorage.removeItem(LEGACY_KEY);
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

export function useViewPrefs(userId?: string | null, businessId?: string | null) {
  const key = viewPrefsKey(userId, businessId);
  const [prefs, setPrefs] = useState<ViewPrefs>(() => readPrefs(key));
  useEffect(() => setPrefs(readPrefs(key)), [key]);
  const update = useCallback((next: ViewPrefs) => {
    setPrefs(next);
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable: keep in memory */ }
  }, [key]);
  return [prefs, update] as const;
}

export function ViewSettings({ prefs, members, open, onOpenChange, onApply, isOwner, isPlatformAdmin = false, permissions, canManageGrants, homeHref, shortcutActions, shortcutStorageScope, printPreferences, onPrintPreferencesChange, onSaveBusinessPrintProfile, printProfileReady = true, printProfileSaving = false, printProfileError, onRetryPrintProfile, businessStatus, onBusinessSelected, onContinuePersonal, onRefreshStatus, onRoleSelected }: {
  prefs: ViewPrefs;
  members: MemberRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (prefs: ViewPrefs) => void;
  isOwner: boolean;
  isPlatformAdmin?: boolean;
  permissions: FacilityPermissions;
  canManageGrants: boolean;
  homeHref: string;
  shortcutActions?: KeyboardShortcutAction[];
  shortcutStorageScope?: string;
  printPreferences?: PrintPreferences;
  onPrintPreferencesChange?: (next: PrintPreferences) => void;
  onSaveBusinessPrintProfile?: () => void;
  printProfileReady?: boolean;
  printProfileSaving?: boolean;
  printProfileError?: string;
  onRetryPrintProfile?: () => void;
  businessStatus?: AuthStatus;
  onBusinessSelected?: (id: string) => Promise<void>;
  onContinuePersonal?: () => void;
  onRefreshStatus?: () => Promise<AuthStatus | undefined>;
  onRoleSelected?: (role: BusinessRolePreference) => void;
}) {
  const canViewEmployees = permissions.allEmployees || permissions.employeeIds.length > 0;
  const canHistory = canViewEmployees || permissions.viewRevenue;
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [, navigate] = useLocation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteHistoryOpen, setDeleteHistoryOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<'business' | 'accounts' | 'billing' | 'shortcuts' | 'printing' | null>(null);
  const [payrollPrintOpen, setPayrollPrintOpen] = useState(false);
  const printPrefs = printPreferences ?? DEFAULT_PRINT_PREFERENCES;

  useEffect(() => {
    if (!open) {
      setPayrollPrintOpen(false);
      setActivePanel(null);
    }
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
        <button type="button" className="gear-btn" aria-label="Cài đặt" data-testid="button-view-settings"><Menu size={20} strokeWidth={2.5} aria-hidden="true" /></button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="settings-overlay" />
        <DialogPrimitive.Content className={`settings-dialog${activePanel === 'accounts' || activePanel === 'billing' ? ' settings-admin-panel' : ''}`} data-testid="dialog-view-settings">
          <div className="dialog-head">
            <DialogPrimitive.Title asChild><h2>{activePanel ? ({
              business: 'Doanh nghiệp và mã tham gia',
              accounts: 'Quản lý tài khoản người dùng',
              billing: 'Phí và thanh toán',
              shortcuts: 'Phím tắt',
              printing: 'In phiếu và thẻ',
            } as const)[activePanel] : 'Cài đặt'}</h2></DialogPrimitive.Title>
            <DialogPrimitive.Close asChild><button type="button" className="icon-btn" aria-label="Đóng cài đặt"><X size={18} /></button></DialogPrimitive.Close>
          </div>
          <>
          <DialogPrimitive.Description className="sub">
            {activePanel === 'accounts' ? 'Danh sách tài khoản và chi tiết dịch vụ, thời hạn, quyền truy cập.'
              : activePanel === 'billing' ? 'Cấu hình phí, mã QR và xác nhận giao dịch.'
                : activePanel === 'business' ? 'Quản lý cơ sở đang tham gia và mã kết nối.'
                  : activePanel === 'shortcuts' ? 'Gán phím tắt riêng cho thiết bị này.'
                    : activePanel === 'printing' ? 'Chọn mẫu, khổ giấy và tùy chọn in.'
                      : isOwner ? 'Lịch sử, cấp quyền quản lý và sổ cá nhân.' : canManageGrants ? 'Lịch sử tháng, quyền quản lý trong phạm vi được cấp và sổ cá nhân.' : 'Lịch sử tháng và sổ cá nhân.'}
          </DialogPrimitive.Description>
          <AccountEmailSetting email={businessStatus?.email} />

          {activePanel === null ? <>
          <Link href="/personal" className="settings-link personal-entry" onClick={() => onOpenChange(false)} data-testid="link-personal-notebook">
            <BookHeart size={17} aria-hidden="true" /><span className="grow"><strong>Chấm công cá nhân</strong><span className="muted">Sổ riêng của tài khoản bạn</span></span><ChevronRight size={16} aria-hidden="true" />
          </Link>

          {businessStatus && onBusinessSelected && onContinuePersonal && onRefreshStatus && (
            <button type="button" className="settings-link"
              onClick={() => setActivePanel('business')} data-testid="button-open-business-access">
              <Building2 size={15} aria-hidden="true" /><span className="grow"><strong>Doanh nghiệp và mã tham gia</strong><span className="muted">Tên doanh nghiệp, mã tham gia và chuyển cơ sở</span></span><ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          {canHistory && (
            <button type="button" className="settings-link" onClick={() => { onOpenChange(false); setHistoryOpen(true); }} data-testid="button-open-history-months">
              <History size={15} aria-hidden="true" /><span className="grow"><strong>Xem lịch sử tháng</strong><span className="muted">{permissions.viewRevenue ? 'Doanh thu và dữ liệu cơ sở theo tháng' : 'Nhân viên theo tháng'}</span></span><ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          {canManageGrants && (
            <button type="button" className="settings-link" onClick={() => { onOpenChange(false); setGrantsOpen(true); }} data-testid="button-open-access-grants">
              <KeyRound size={15} aria-hidden="true" /><span className="grow"><strong>Cấp quyền quản lý</strong><span className="muted">{isOwner ? 'Danh sách và quyền của nhiều tài khoản' : 'Xem và cấp trong phạm vi quyền của bạn'}</span></span><ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          {isPlatformAdmin && (
            <>
              <button type="button" className="settings-link platform-billing-entry"
                onClick={() => setActivePanel('accounts')} data-testid="button-open-platform-accounts">
                <KeyRound size={15} aria-hidden="true" /><span className="grow"><strong>Quản lý tài khoản người dùng</strong><span className="muted">Xem từng tài khoản, thời hạn dùng thử, gói và quyền</span></span><ChevronRight size={16} aria-hidden="true" />
              </button>
              <button type="button" className="settings-link platform-billing-entry"
                onClick={() => setActivePanel('billing')} data-testid="button-open-platform-billing">
                <CreditCard size={15} aria-hidden="true" /><span className="grow"><strong>Phí và thanh toán</strong><span className="muted">Bật phí riêng, mã QR và duyệt yêu cầu thanh toán</span></span><ChevronRight size={16} aria-hidden="true" />
              </button>
            </>
          )}

          {isOwner && (
            <button type="button" className="settings-link" onClick={() => { onOpenChange(false); setDeleteHistoryOpen(true); }} data-testid="button-open-delete-history">
              <Trash2 size={15} aria-hidden="true" /><span className="grow"><strong>Xóa lịch sử chấm công</strong><span className="muted">Chọn khoảng ngày cần xóa</span></span><ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          {shortcutActions && <button type="button" className="settings-link" onClick={() => setActivePanel('shortcuts')} data-testid="button-open-keyboard-shortcuts">
            <Keyboard size={15} aria-hidden="true" /><span className="grow"><strong>Phím tắt</strong><span className="muted">Gán thao tác cho bàn phím trên thiết bị</span></span><ChevronRight size={16} aria-hidden="true" />
          </button>}

          {onPrintPreferencesChange && (
            <button type="button" className="settings-link" onClick={() => setActivePanel('printing')} data-testid="button-open-print-settings">
              <Printer size={15} aria-hidden="true" /><span className="grow"><strong>In phiếu và thẻ</strong><span className="muted">Tùy chỉnh mẫu, khổ giấy và tự động in</span></span><ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          <nav className="window-nav bottom" aria-label="Điều hướng cửa sổ">
            <Link href={homeHref} onClick={() => onOpenChange(false)} className="btn ghost nav-home-action" data-testid="link-settings-home"><Home size={14} aria-hidden="true" />Trang chính</Link>
            <button type="button" className="btn ghost nav-return-action" onClick={() => onOpenChange(false)} data-testid="button-settings-back"><ArrowLeft size={14} aria-hidden="true" />Trở về</button>
          </nav>
          </> : <section className="settings-panel-view" data-testid={`settings-panel-${activePanel}`}>
            <button type="button" className="settings-link settings-panel-back" onClick={() => setActivePanel(null)} data-testid="button-settings-panel-back">
              <ArrowLeft size={15} aria-hidden="true" /><span>Quay lại Cài đặt</span>
            </button>
            {activePanel === 'business' && businessStatus && onBusinessSelected && onContinuePersonal && onRefreshStatus && (
              <BusinessAccessSettings status={businessStatus} onBusinessSelected={onBusinessSelected}
                onContinuePersonal={() => { onOpenChange(false); onContinuePersonal(); }}
                onRefreshStatus={onRefreshStatus} onCloseSettings={() => onOpenChange(false)}
                onRoleSelected={onRoleSelected} />
            )}
            {activePanel === 'accounts' && isPlatformAdmin && <PlatformBillingAdmin view="accounts" />}
            {activePanel === 'billing' && isPlatformAdmin && <PlatformBillingAdmin view="billing" />}
            {activePanel === 'shortcuts' && shortcutActions && <KeyboardShortcutsSettings actions={shortcutActions} storageScope={shortcutStorageScope} expanded />}
            {activePanel === 'printing' && onPrintPreferencesChange && (
            <section className="print-settings" aria-labelledby="print-settings-title">
              <h3 id="print-settings-title"><Printer size={16} aria-hidden="true" />In phiếu và thẻ</h3>
              {printProfileError && (
                <p role="alert" className="print-preview-note">
                  {printProfileError}{onRetryPrintProfile && <> <button type="button" className="link-soft as-button" onClick={onRetryPrintProfile}>Thử lại</button></>}
                </p>
              )}
              <label className="print-setting-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={printPrefs.autoPrintServiceSessions}
                  onChange={(event) => onPrintPreferencesChange({ ...printPrefs, autoPrintServiceSessions: event.target.checked })}
                  data-testid="switch-auto-print-sessions"
                />
                <span><strong>Tự in phiếu khi chấm công</strong><small>Nhân viên, khách, dịch vụ, giờ, ngày, thanh toán và tiền công</small></span>
              </label>
              <label className="print-setting-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={printPrefs.autoPrintCardSales}
                  onChange={(event) => onPrintPreferencesChange({ ...printPrefs, autoPrintCardSales: event.target.checked })}
                  data-testid="switch-auto-print-card-sales"
                />
                <span><strong>Tự in phiếu khi bán thẻ</strong><small>Khách, dịch vụ, giờ, tiền, phương thức, người bán và ngày</small></span>
              </label>
              <label className="print-setting-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={printPrefs.autoPrintCardTopUps}
                  onChange={(event) => onPrintPreferencesChange({ ...printPrefs, autoPrintCardTopUps: event.target.checked })}
                  data-testid="switch-auto-print-card-topups"
                />
                <span><strong>Tự in phiếu khi nạp thẻ</strong><small>Khách, giờ nạp, tiền, phương thức, người nạp và ngày</small></span>
              </label>
              <label className="field" htmlFor="print-paper-size">Khổ giấy
                <select id="print-paper-size" value={printPrefs.paperSize}
                  onChange={(event) => onPrintPreferencesChange({ ...printPrefs, paperSize: event.target.value as PrintPreferences['paperSize'] })}
                  data-testid="select-print-paper-size">
                  {PRINT_PAPER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              {printPrefs.paperSize === 'custom' && (
                <div className="field-row">
                  <label className="field" htmlFor="print-paper-width">Chiều rộng (mm)
                    <input id="print-paper-width" type="number" inputMode="numeric" min={20} max={1200} step={1}
                      value={printPrefs.customWidthMm}
                      onChange={(event) => onPrintPreferencesChange({ ...printPrefs, customWidthMm: Number(event.target.value) })}
                      data-testid="input-print-paper-width" />
                  </label>
                  <label className="field" htmlFor="print-paper-height">Chiều cao (mm)
                    <input id="print-paper-height" type="number" inputMode="numeric" min={20} max={1200} step={1}
                      value={printPrefs.customHeightMm}
                      onChange={(event) => onPrintPreferencesChange({ ...printPrefs, customHeightMm: Number(event.target.value) })}
                      data-testid="input-print-paper-height" />
                  </label>
                </div>
              )}
              <p className="print-preview-note">Có các khổ nhiệt, ISO A/B và khổ Mỹ thông dụng; khổ riêng nhập chiều rộng và cao. Máy in có thể giới hạn lựa chọn thực tế trong hộp thoại in.</p>
              <label className="field" htmlFor="print-facility-name">Tên cơ sở trên hóa đơn
                <input id="print-facility-name" type="text" maxLength={120}
                  value={printPrefs.facilityName}
                  onChange={(event) => onPrintPreferencesChange({ ...printPrefs, facilityName: event.target.value })}
                  readOnly={!isOwner || !printProfileReady}
                  placeholder="Nhập tên cơ sở"
                  data-testid="input-print-facility-name" />
              </label>
              <label className="field" htmlFor="print-facility-address">Địa chỉ cơ sở
                <input id="print-facility-address" type="text" maxLength={240}
                  value={printPrefs.facilityAddress}
                  onChange={(event) => onPrintPreferencesChange({ ...printPrefs, facilityAddress: event.target.value })}
                  readOnly={!isOwner || !printProfileReady}
                  placeholder="Nhập địa chỉ cơ sở"
                  data-testid="input-print-facility-address" />
              </label>
              <label className="field" htmlFor="print-facility-tax-code">Mã số thuế (nếu có)
                <input id="print-facility-tax-code" type="text" maxLength={40}
                  value={printPrefs.facilityTaxCode}
                  onChange={(event) => onPrintPreferencesChange({ ...printPrefs, facilityTaxCode: event.target.value })}
                  readOnly={!isOwner || !printProfileReady}
                  placeholder="Nhập mã số thuế"
                  data-testid="input-print-facility-tax-code" />
              </label>
              <label className="field" htmlFor="print-facility-phone">Số điện thoại cơ sở trên thẻ
                <input id="print-facility-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40}
                  value={printPrefs.facilityPhone}
                  onChange={(event) => onPrintPreferencesChange({ ...printPrefs, facilityPhone: event.target.value })}
                  readOnly={!isOwner || !printProfileReady}
                  placeholder="Nhập số điện thoại cơ sở"
                  data-testid="input-print-facility-phone" />
              </label>
              {isOwner && onSaveBusinessPrintProfile && (
                <button type="button" className="settings-link" onClick={onSaveBusinessPrintProfile}
                  disabled={!printProfileReady || printProfileSaving} data-testid="button-save-business-print-profile">
                  {printProfileSaving ? 'Đang lưu thông tin cơ sở…' : 'Lưu thông tin in của cơ sở'}
                </button>
              )}
              <PrintPreview key={open ? 'settings-open' : 'settings-closed'}
                paperSize={printPrefs.paperSize} customWidthMm={printPrefs.customWidthMm}
                customHeightMm={printPrefs.customHeightMm} facilityName={printPrefs.facilityName}
                facilityAddress={printPrefs.facilityAddress} facilityTaxCode={printPrefs.facilityTaxCode}
                facilityPhone={printPrefs.facilityPhone} />
              {canViewEmployees && (
                <details className="print-template-row print-template-row--payroll" open={payrollPrintOpen}
                  onToggle={(event) => setPayrollPrintOpen(event.currentTarget.open)}
                  data-testid="details-print-preview-payroll">
                  <summary>
                    <span><strong>Tổng công nhân viên</strong><small>Mẫu in và tải Excel theo tháng</small></span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  {payrollPrintOpen && <MonthlyPayrollPrint enabled={canViewEmployees} />}
                </details>
              )}
            </section>
            )}
          </section>}
          </>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
    {historyOpen && <HistoryMonthsDialog listOnly onPick={pickHistory} onClose={() => setHistoryOpen(false)} />}
    {deleteHistoryOpen && isOwner && <HistoryDeleteDialog onClose={() => setDeleteHistoryOpen(false)} />}
    {grantsOpen && canManageGrants && <AccessGrantsDialog members={members} isOwner={isOwner} permissions={permissions} onClose={() => setGrantsOpen(false)} />}
    </>
  );
}
