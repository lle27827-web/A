import { useCallback, useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, Settings, X } from 'lucide-react';

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

export function ViewSettings({ prefs, members, membersLoading, open, onOpenChange, onApply }: {
  prefs: ViewPrefs;
  members: MemberRecord[];
  membersLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (prefs: ViewPrefs) => void;
}) {
  const [mode, setMode] = useState<ViewMode>(prefs.mode);
  const [employeeId, setEmployeeId] = useState<string>(prefs.employeeId ? String(prefs.employeeId) : '');
  const [error, setError] = useState('');

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

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger asChild>
        <button type="button" className="gear-btn" aria-label="Cài đặt chế độ xem" data-testid="button-view-settings"><Settings size={18} /></button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="settings-overlay" />
        <DialogPrimitive.Content className="settings-dialog" data-testid="dialog-view-settings">
          <div className="dialog-head">
            <DialogPrimitive.Title asChild><h2>Chế độ xem</h2></DialogPrimitive.Title>
            <DialogPrimitive.Close asChild><button type="button" className="icon-btn" aria-label="Đóng cài đặt"><X size={18} /></button></DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sub">Đổi chế độ xem không thay đổi quyền. Chỉ chủ sở hữu đã đăng nhập, ở chế độ Chủ, mới chỉnh sửa được.</DialogPrimitive.Description>
          <form onSubmit={(e) => { e.preventDefault(); apply(); }}>
            <fieldset>
              <legend>Bố cục</legend>
              <div className="mode-options">
                <label className="mode-option">
                  <input type="radio" name="view-mode" value="owner" checked={mode === 'owner'} onChange={() => { setMode('owner'); setError(''); }} data-testid="radio-mode-owner" />
                  <strong>Chủ</strong><span>Tổng quan theo ngày và danh sách Nhân viên.</span>
                </label>
                <label className="mode-option">
                  <input type="radio" name="view-mode" value="employee" checked={mode === 'employee'} onChange={() => setMode('employee')} data-testid="radio-mode-employee" />
                  <strong>Nhân viên</strong><span>Chỉ lịch sử ca của một Nhân viên, chỉ xem.</span>
                </label>
              </div>
            </fieldset>
            {mode === 'employee' && (
              <label className="field" htmlFor="view-employee" style={{ marginTop: 14 }}>Nhân viên được xem
                <select id="view-employee" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'view-employee-error' : undefined} disabled={membersLoading} data-testid="select-view-employee">
                  <option value="">{membersLoading ? 'Đang tải…' : members.length ? 'Chọn Nhân viên' : 'Chưa có Nhân viên'}</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            )}
            {error && <p id="view-employee-error" className="form-error" role="alert" style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}><AlertCircle size={14} />{error}</p>}
            <div className="dialog-actions" style={{ marginTop: 18 }}>
              <DialogPrimitive.Close asChild><button type="button" className="btn ghost">Hủy</button></DialogPrimitive.Close>
              <button type="submit" className="btn primary" data-testid="button-apply-view">Áp dụng</button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
