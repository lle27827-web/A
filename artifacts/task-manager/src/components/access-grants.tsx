import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAccessGrantsQueryKey, useDeleteAccessGrant, useListAccessGrants, useSaveAccessGrant,
} from '@workspace/api-client-react';
import type { AccessGrant, FacilityPermissions, MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, KeyRound, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog, ErrorBanner, Modal, Skeleton, type ConfirmState } from '@/components/modal';
import { errorText } from '@/lib/massage';

type Scope = 'none' | 'all' | 'selected';
type Draft = {
  id: number | null; email: string; scope: Scope; employeeIds: number[];
  viewCards: boolean; editCards: boolean; viewRevenue: boolean; editEmployees: boolean; editServices: boolean;
  viewAppointments: boolean; editAppointments: boolean;
};

const EMPTY: Draft = { id: null, email: '', scope: 'none', employeeIds: [], viewCards: false, editCards: false, viewRevenue: false, editEmployees: false, editServices: false, viewAppointments: false, editAppointments: false };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fromGrant(g: AccessGrant): Draft {
  const p = g.permissions;
  return {
    id: g.id, email: g.email,
    scope: p.allEmployees ? 'all' : p.employeeIds.length ? 'selected' : 'none',
    employeeIds: [...p.employeeIds], viewCards: p.viewCards || p.editCards, editCards: p.editCards,
    viewRevenue: p.viewRevenue, editEmployees: p.editEmployees, editServices: p.editServices,
    viewAppointments: p.viewAppointments || p.editAppointments, editAppointments: p.editAppointments,
  };
}

/** Normalised: edit rights imply viewing; employee edits require an employee scope. */
function toPermissions(d: Draft): FacilityPermissions {
  const hasScope = d.scope === 'all' || (d.scope === 'selected' && d.employeeIds.length > 0);
  return {
    allEmployees: d.scope === 'all',
    employeeIds: d.scope === 'selected' ? [...new Set(d.employeeIds)].sort((a, b) => a - b) : [],
    viewCards: d.viewCards || d.editCards,
    editCards: d.editCards,
    viewRevenue: d.viewRevenue,
    editEmployees: hasScope && d.editEmployees,
    editServices: d.editServices,
    viewAppointments: d.viewAppointments || d.editAppointments,
    editAppointments: d.editAppointments,
  };
}

function summary(p: FacilityPermissions, members: MemberRecord[]): string {
  const parts: string[] = [];
  if (p.allEmployees) parts.push('Tất cả nhân viên');
  else if (p.employeeIds.length) {
    const names = p.employeeIds.map((id) => members.find((m) => m.id === id)?.name ?? `#${id}`);
    parts.push(`Nhân viên: ${names.join(', ')}`);
  }
  if (p.editEmployees) parts.push('sửa nhân viên và ca');
  if (p.editCards) parts.push('xem và sửa thẻ');
  else if (p.viewCards) parts.push('xem thẻ');
  if (p.viewRevenue) parts.push('xem doanh thu');
  if (p.editServices) parts.push('sửa dịch vụ');
  if (p.editAppointments) parts.push('xem và sửa lịch hẹn');
  else if (p.viewAppointments) parts.push('xem lịch hẹn');
  return parts.length ? parts.join(' · ') : 'Không có quyền';
}

export function AccessGrantsDialog({ members, onClose }: { members: MemberRecord[]; onClose: () => void }) {
  const cache = useQueryClient();
  const grants = useListAccessGrants({ query: { queryKey: getListAccessGrantsQueryKey(), refetchOnWindowFocus: true } });
  const save = useSaveAccessGrant();
  const remove = useDeleteAccessGrant();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [notice, setNotice] = useState('');
  const list = useMemo(() => [...(grants.data ?? [])].sort((a, b) => a.email.localeCompare(b.email)), [grants.data]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setError('');
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || save.isPending) return;
    const email = draft.email.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return setError('Nhập email hợp lệ.');
    if (draft.id === null && list.some((g) => g.email.toLowerCase() === email)) return setError('Email này đã có quyền. Hãy sửa dòng hiện có.');
    if (draft.scope === 'selected' && draft.employeeIds.length === 0) return setError('Chọn ít nhất một nhân viên.');
    const permissions = toPermissions(draft);
    if (!hasAny(permissions)) return setError('Chọn ít nhất một quyền.');
    save.mutate({ data: { email, permissions } }, {
      onSuccess: () => {
        void cache.invalidateQueries({ queryKey: getListAccessGrantsQueryKey() });
        setDraft(null);
        setNotice(`Đã lưu quyền cho ${email}.`);
      },
      onError: (e) => setError(errorText(e)),
    });
  }

  function askRevoke(g: AccessGrant) {
    setNotice('');
    setConfirm({
      title: `Thu hồi quyền của ${g.email}?`,
      body: <p>Tài khoản này sẽ mất mọi quyền xem và sửa dữ liệu cơ sở. Sổ cá nhân của họ không bị ảnh hưởng.</p>,
      confirmLabel: 'Thu hồi quyền',
      onConfirm: () => remove.mutate({ id: g.id }, {
        onSuccess: () => {
          void cache.invalidateQueries({ queryKey: getListAccessGrantsQueryKey() });
          setConfirm(null);
          if (draft?.id === g.id) setDraft(null);
          setNotice(`Đã thu hồi quyền của ${g.email}.`);
        },
        onError: (e) => { setConfirm(null); setNotice(''); setError(errorText(e)); },
      }),
    });
  }

  const hasScope = draft ? draft.scope === 'all' || (draft.scope === 'selected' && draft.employeeIds.length > 0) : false;

  return (
    <>
      <Modal title="Cấp quyền quản lý" onClose={onClose} testId="dialog-access-grants">
        {notice && <p className="banner success" role="status" data-testid="status-grant-notice">{notice}</p>}
        {!draft && error && <p className="form-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{error}</p>}

        {draft ? (
          <form className="grant-form" onSubmit={submit} noValidate data-testid="form-access-grant">
            <h3 className="group-title">{draft.id === null ? 'Cấp quyền mới' : 'Sửa quyền'}</h3>
            <label className="field" htmlFor="grant-email">Email
              <input id="grant-email" type="email" inputMode="email" autoComplete="off" value={draft.email} maxLength={254}
                readOnly={draft.id !== null} onChange={(e) => set('email', e.target.value)}
                aria-invalid={!!error} aria-describedby={error ? 'grant-error' : undefined} data-testid="input-grant-email" />
            </label>

            <fieldset className="grant-group">
              <legend>Nhân viên được xem</legend>
              {(['none', 'all', 'selected'] as const).map((scope) => (
                <label key={scope} className="grant-check">
                  <input type="radio" name="grant-scope" checked={draft.scope === scope}
                    onChange={() => { setError(''); setDraft((d) => d ? { ...d, scope, editEmployees: scope === 'none' ? false : d.editEmployees } : d); }}
                    data-testid={`radio-grant-scope-${scope}`} />
                  <span>{scope === 'none' ? 'Không xem nhân viên' : scope === 'all' ? 'Tất cả nhân viên' : 'Nhân viên được chọn'}</span>
                </label>
              ))}
              {draft.scope === 'selected' && (
                <div className="grant-members" role="group" aria-label="Nhân viên được chọn">
                  {members.length === 0 ? <p className="muted small">Chưa có nhân viên.</p> : members.map((m) => (
                    <label key={m.id} className="grant-check">
                      <input type="checkbox" checked={draft.employeeIds.includes(m.id)}
                        onChange={(e) => set('employeeIds', e.target.checked ? [...draft.employeeIds, m.id] : draft.employeeIds.filter((id) => id !== m.id))}
                        data-testid={`checkbox-grant-member-${m.id}`} />
                      <span>{m.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <label className="grant-check">
                <input type="checkbox" checked={hasScope && draft.editEmployees} disabled={!hasScope}
                  onChange={(e) => set('editEmployees', e.target.checked)} data-testid="checkbox-grant-edit-employees" />
                <span>Sửa nhân viên và ca trong phạm vi trên</span>
              </label>
              {draft.scope === 'selected' && draft.editEmployees && <p className="hint">Thêm nhân viên mới cần quyền tất cả nhân viên.</p>}
            </fieldset>

            <fieldset className="grant-group">
              <legend>Thẻ, doanh thu, dịch vụ</legend>
              <label className="grant-check">
                <input type="checkbox" checked={draft.viewCards || draft.editCards}
                  onChange={(e) => { setError(''); setDraft((d) => d ? { ...d, viewCards: e.target.checked, editCards: e.target.checked ? d.editCards : false } : d); }}
                  data-testid="checkbox-grant-view-cards" />
                <span>Xem thẻ khách</span>
              </label>
              <label className="grant-check">
                <input type="checkbox" checked={draft.editCards}
                  onChange={(e) => { setError(''); setDraft((d) => d ? { ...d, editCards: e.target.checked, viewCards: e.target.checked || d.viewCards } : d); }}
                  data-testid="checkbox-grant-edit-cards" />
                <span>Sửa thẻ khách</span>
              </label>
              <label className="grant-check">
                <input type="checkbox" checked={draft.viewRevenue} onChange={(e) => set('viewRevenue', e.target.checked)} data-testid="checkbox-grant-view-revenue" />
                <span>Xem doanh thu</span>
              </label>
              <label className="grant-check">
                <input type="checkbox" checked={draft.editServices} onChange={(e) => set('editServices', e.target.checked)} data-testid="checkbox-grant-edit-services" />
                <span>Sửa dịch vụ và giá</span>
              </label>
            </fieldset>

            <fieldset className="grant-group">
              <legend>Lịch hẹn cơ sở</legend>
              <label className="grant-check">
                <input type="checkbox" checked={draft.viewAppointments || draft.editAppointments}
                  onChange={(e) => { setError(''); setDraft((d) => d ? { ...d, viewAppointments: e.target.checked, editAppointments: e.target.checked ? d.editAppointments : false } : d); }}
                  data-testid="checkbox-grant-view-appointments" />
                <span>Xem lịch hẹn</span>
              </label>
              <label className="grant-check">
                <input type="checkbox" checked={draft.editAppointments}
                  onChange={(e) => { setError(''); setDraft((d) => d ? { ...d, editAppointments: e.target.checked, viewAppointments: e.target.checked || d.viewAppointments } : d); }}
                  data-testid="checkbox-grant-edit-appointments" />
                <span>Tạo, sửa và xóa lịch hẹn</span>
              </label>
            </fieldset>

            {error && <p id="grant-error" className="form-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn ghost" onClick={() => { setDraft(null); setError(''); }} data-testid="button-grant-cancel">Hủy</button>
              <button type="submit" className="btn primary" disabled={save.isPending} data-testid="button-grant-save">
                {save.isPending && <LoaderCircle size={14} className="spin" aria-hidden="true" />}Lưu quyền
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn primary grant-add" onClick={() => { setNotice(''); setError(''); setDraft({ ...EMPTY }); }} data-testid="button-add-grant">
            <Plus size={14} aria-hidden="true" />Cấp quyền cho email
          </button>
        )}

        <h3 className="group-title">Đã cấp</h3>
        {grants.isLoading ? <Skeleton rows={3} label="Đang tải quyền" /> : grants.isError ? (
          <ErrorBanner text="Không tải được danh sách quyền." onRetry={() => void grants.refetch()} />
        ) : list.length === 0 ? (
          <div className="empty small"><KeyRound size={18} aria-hidden="true" /><p>Chưa cấp quyền cho ai.</p></div>
        ) : (
          <ul className="grant-list">
            {list.map((g) => (
              <li key={g.id} className="grant-row" data-testid={`row-grant-${g.id}`}>
                <span className="grow">
                  <strong data-testid={`text-grant-email-${g.id}`}>{g.email}</strong>
                  <span className="muted">{summary(g.permissions, members)}</span>
                </span>
                <span className="row-actions text-actions">
                  <button type="button" className="btn small" onClick={() => { setNotice(''); setError(''); setDraft(fromGrant(g)); }} aria-label={`Sửa quyền ${g.email}`} data-testid={`button-edit-grant-${g.id}`}><Pencil size={14} aria-hidden="true" />Sửa</button>
                  <button type="button" className="btn small danger" disabled={remove.isPending} onClick={() => askRevoke(g)} aria-label={`Thu hồi quyền ${g.email}`} data-testid={`button-revoke-grant-${g.id}`}><Trash2 size={14} aria-hidden="true" />Thu hồi</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      {confirm && <ConfirmDialog state={confirm} busy={remove.isPending} onClose={() => setConfirm(null)} />}
    </>
  );
}

function hasAny(p: FacilityPermissions) {
  return p.allEmployees || p.employeeIds.length > 0 || p.viewCards || p.viewRevenue || p.editServices || p.viewAppointments || p.editAppointments;
}
