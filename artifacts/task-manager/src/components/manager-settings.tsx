import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetCurrentAccessQueryKey, getListManagersQueryKey, useCreateManager, useDeleteManager, useListManagers } from '@workspace/api-client-react';
import type { ManagerGrant } from '@workspace/api-client-react';
import { AlertCircle, LoaderCircle, Trash2, UserPlus, UsersRound } from 'lucide-react';
import { errorText } from '@/lib/massage';
import { statusCode } from '@/lib/attendance';

export function ManagerSettings({ canEdit, onAuthError }: { canEdit: boolean; onAuthError: (err: unknown) => void }) {
  const cache = useQueryClient();
  const list = useListManagers({ query: { queryKey: getListManagersQueryKey(), staleTime: 15_000, refetchOnWindowFocus: true } });
  const create = useCreateManager();
  const remove = useDeleteManager();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState<ManagerGrant | null>(null);

  function refresh() {
    void cache.invalidateQueries({ queryKey: getListManagersQueryKey() });
    void cache.invalidateQueries({ queryKey: getGetCurrentAccessQueryKey() });
  }
  function authFail(err: unknown) {
    const s = statusCode(err);
    if (s === 401 || s === 403) onAuthError(err);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 320) return setError('Email không hợp lệ.');
    setError(''); setMsg('');
    create.mutate({ data: { email: v } }, {
      onSuccess: (g) => { refresh(); setEmail(''); setMsg(`Đã cấp quyền quản lý cho ${g.email}.`); },
      onError: (err) => { setError(errorText(err)); authFail(err); },
    });
  }
  function revoke() {
    if (!pending || !canEdit) return;
    const g = pending;
    remove.mutate({ id: g.id }, {
      onSuccess: () => { refresh(); setPending(null); setMsg(`Đã thu hồi quyền của ${g.email}.`); },
      onError: (err) => { setPending(null); setError(errorText(err)); authFail(err); },
    });
  }

  const grants = list.data ?? [];
  return (
    <section className="mgr" aria-labelledby="mgr-title" data-testid="section-managers">
      <h3 id="mgr-title"><UsersRound size={15} />Quyền quản lý</h3>
      <p className="sub">Người nhận phải đăng nhập bằng đúng email đã xác minh. Quản lý được thêm, sửa và xóa dữ liệu, nhưng không cấp hoặc thu hồi quyền quản lý.</p>
      {canEdit ? (
        <form className="mgr-form" onSubmit={submit} noValidate>
          <label htmlFor="mgr-email" className="sr-only">Email quản lý</label>
          <input id="mgr-email" type="email" inputMode="email" autoComplete="off" placeholder="email@vidu.com" value={email} maxLength={320}
            onChange={(e) => { setEmail(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'mgr-error' : undefined} data-testid="input-manager-email" />
          <button type="submit" className="btn primary" disabled={create.isPending} data-testid="button-add-manager">{create.isPending ? <LoaderCircle size={14} className="spin" /> : <UserPlus size={14} />}Cấp quyền</button>
        </form>
      ) : <p className="hint warn">Chuyển sang bố cục Chủ để cấp hoặc thu hồi quyền.</p>}
      {error && <p id="mgr-error" className="form-error" role="alert"><AlertCircle size={13} />{error}</p>}
      {msg && <p className="hint" role="status" data-testid="status-manager">{msg}</p>}
      {pending && (
        <div className="mgr-confirm" role="alertdialog" aria-labelledby="mgr-confirm-text">
          <p id="mgr-confirm-text">Thu hồi quyền quản lý được cấp qua email <strong>{pending.email}</strong>?</p>
          <div className="dialog-actions">
            <button type="button" className="btn small ghost" onClick={() => setPending(null)}>Hủy</button>
            <button type="button" className="btn small danger" disabled={remove.isPending} onClick={revoke} data-testid="button-confirm-revoke">{remove.isPending && <LoaderCircle size={13} className="spin" />}Thu hồi</button>
          </div>
        </div>
      )}
      {list.isLoading ? <div className="skeleton-list" aria-label="Đang tải danh sách quản lý"><span /><span /></div>
        : list.isError ? <p className="form-error" role="alert"><AlertCircle size={13} />Không tải được danh sách quản lý. <button type="button" className="link-soft as-button" onClick={() => void list.refetch()}>Thử lại</button></p>
        : grants.length === 0 ? <p className="hint">Chưa cấp quyền quản lý cho ai.</p>
        : (
          <ul className="mgr-list" aria-label="Danh sách quản lý">
            {grants.map((g) => (
              <li key={g.id} data-testid={`row-manager-${g.id}`}>
                <span className="grow"><strong>{g.email}</strong><span className="muted hint">Cấp ngày {new Date(g.createdAt).toLocaleDateString('vi-VN')}</span></span>
                {canEdit && <button type="button" className="icon-btn danger" onClick={() => { setError(''); setPending(g); }} aria-label={`Thu hồi quyền của ${g.email}`} data-testid={`button-revoke-manager-${g.id}`}><Trash2 size={14} /></button>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
