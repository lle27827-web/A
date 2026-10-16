import { useCallback, useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { FacilityPermissions, MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, BookHeart, ChevronRight, History, Home, KeyRound, Settings, Sparkles, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { HistoryMonthsDialog } from '@/components/history-months-dialog';
import { AccessGrantsDialog } from '@/components/access-grants';

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
    const mode: ViewMode = o.mode === 'employee' ? 'employee' : 'owner';
    const id = typeof o.employeeId === 'number' && Number.isInteger(o.employeeId) && o.employeeId > 0 ? o.employeeId : null;
    return { mode, employeeId: id };
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

export function ViewSettings({ prefs, members, membersLoading, open, onOpenChange, onApply, isOwner, permissions }: {
  prefs: ViewPrefs;
  members: MemberRecord[];
  membersLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (prefs: ViewPrefs) => void;
  isOwner: boolean;
  permissions: FacilityPermissions;
}) {
  const canViewEmployees = permissions.allEmployees || permissions.employeeIds.length > 0;
  const canHistory = canViewEmployees || permissions.viewRevenue;
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<ViewMode>(prefs.mode);
  const [employeeId, setEmployeeId] = useState<string>(prefs.employeeId ? String(prefs.employeeId) : '');
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(prefs.mode);
      setEmployeeId(prefs.employeeId === null ? '' : String(prefs.employeeId));
      setError('');
    }
  }, [open, prefs.mode, prefs.employeeId]);

  function apply() {
    if (mode === 'employee') {
      const id = Number(employeeId);
      if (!employeeId || !members.some((m) => m.id === id)) { setError('Hãy chọn một nhân viên để xem.'); return; }
      onApply({ mode, employeeId: id });
    } else {
      onApply({ mode: 'owner', employeeId: prefs.employeeId });
    }
    onOpenChange(false);
  }

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
            {isOwner ? 'Lịch sử, dịch vụ, quyền truy cập và sổ cá nhân.' : 'Lịch sử tháng và sổ cá nhân.'}
          </DialogPrimitive.Description>

          <Link href="/personal" className="settings-link personal-entry" onClick={() => onOpenChange(false)} data-testid="link-personal-notebook">
            <BookHeart size={17} aria-hidden="true" /><span className="grow"><strong>Chấm công cá nhân</strong><span className="muted">Sổ riêng của tài khoản bạn</span></span><ChevronRight size={16} aria-hidden="true" />
          </Link>

          {canHistory && (
            <button type="button" className="settings-link" onClick={() => setHistoryOpen(true)} data-testid="button-open-history-months">
              <History size={15} aria-hidden="true" /><span className="grow"><strong>Xem lịch sử tháng</strong><span className="muted">{permissions.viewRevenue ? 'Doanh thu và dữ liệu cơ sở theo tháng' : 'Nhân viên theo tháng'}</span></span><ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          {permissions.editServices && (
            <Link href="/services" className="settings-link" onClick={() => { onApply({ mode: 'owner', employeeId: prefs.employeeId }); onOpenChange(false); }} data-testid="link-services"><Sparkles size={15} aria-hidden="true" /><span className="grow"><strong>Dịch vụ &amp; giá trả công</strong><span className="muted">Thêm, sửa, xóa dịch vụ của cơ sở</span></span><ChevronRight size={16} aria-hidden="true" /></Link>
          )}

          {isOwner && (
            <button type="button" className="settings-link" onClick={() => { onOpenChange(false); setGrantsOpen(true); }} data-testid="button-open-access-grants">
              <KeyRound size={15} aria-hidden="true" /><span className="grow"><strong>Quyền truy cập</strong><span className="muted">Cấp quyền chi tiết cho từng email</span></span><ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          {isOwner && (
            <>
              <form onSubmit={(e) => { e.preventDefault(); apply(); }}>
                <fieldset>
                  <legend>Bố cục cơ sở</legend>
                  <div className="mode-options">
                    <label className="mode-option">
                      <input type="radio" name="view-mode" value="owner" checked={mode === 'owner'} onChange={() => { setMode('owner'); setError(''); }} data-testid="radio-mode-owner" />
                      <strong>Chủ</strong><span>Tổng quan theo ngày và danh sách Nhân viên.</span>
                    </label>
                    <label className="mode-option">
                      <input type="radio" name="view-mode" value="employee" checked={mode === 'employee'} onChange={() => setMode('employee')} data-testid="radio-mode-employee" />
                      <strong>Xem như nhân viên (cơ sở)</strong><span>Chỉ xem dữ liệu cơ sở của một nhân viên. Không phải sổ cá nhân.</span>
                    </label>
                  </div>
                </fieldset>
                {mode === 'employee' && (
                  <label className="field" htmlFor="view-employee" style={{ marginTop: 14 }}>Nhân viên cơ sở được xem
                    <select id="view-employee" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'view-employee-error' : undefined} disabled={membersLoading} data-testid="select-view-employee">
                      <option value="">{membersLoading ? 'Đang tải…' : members.length ? 'Chọn Nhân viên' : 'Chưa có Nhân viên'}</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </label>
                )}
                {error && <p id="view-employee-error" className="form-error" role="alert" style={{ marginTop: 8 }}><AlertCircle size={14} />{error}</p>}
                <div className="dialog-actions" style={{ marginTop: 18 }}>
                  <DialogPrimitive.Close asChild><button type="button" className="btn ghost">Hủy</button></DialogPrimitive.Close>
                  <button type="submit" className="btn primary" data-testid="button-apply-view">Áp dụng</button>
                </div>
              </form>
            </>
          )}
          <nav className="window-nav bottom" aria-label="Điều hướng cửa sổ">
            <Link href="/" onClick={() => onOpenChange(false)} className="btn ghost" data-testid="link-settings-home"><Home size={14} aria-hidden="true" />Trang chính</Link>
            <button type="button" className="btn ghost" onClick={() => onOpenChange(false)} data-testid="button-settings-back"><ArrowLeft size={14} aria-hidden="true" />Trở về</button>
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
    {historyOpen && <HistoryMonthsDialog onPick={pickHistory} onClose={() => setHistoryOpen(false)}
      description={permissions.viewRevenue ? 'Chọn tháng để xem doanh thu và dữ liệu cơ sở (chỉ xem).' : 'Chọn tháng để xem danh sách nhân viên tháng đó (chỉ xem).'} />}
    {grantsOpen && isOwner && <AccessGrantsDialog members={members} onClose={() => setGrantsOpen(false)} />}
    </>
  );
}
