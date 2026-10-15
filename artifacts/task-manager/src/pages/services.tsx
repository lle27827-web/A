import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListServiceTypesQueryKey, useCreateServiceType, useDeleteServiceType, useListServiceTypes, useUpdateServiceType } from '@workspace/api-client-react';
import type { ServiceTypeRecord } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, LoaderCircle, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import { useShell } from '@/components/app-shell';
import { ConfirmDialog, ErrorBanner, Modal, Skeleton, type ConfirmState } from '@/components/modal';
import { statusCode } from '@/lib/attendance';
import { errorText, formatVnd, parseMoney, useRefreshMassage } from '@/lib/massage';

export default function ServicesPage() {
  return <ServiceCatalog />;
}

export function ServiceCatalog({ embedded = false }: { embedded?: boolean }) {
  const { canEdit, notify, fail } = useShell();
  const q = useListServiceTypes({ query: { queryKey: getListServiceTypesQueryKey(), staleTime: 20_000, refetchInterval: 60_000, refetchOnWindowFocus: true } });
  const create = useCreateServiceType();
  const update = useUpdateServiceType();
  const del = useDeleteServiceType();
  const refresh = useRefreshMassage();
  const cache = useQueryClient();
  const [dialog, setDialog] = useState<{ service: ServiceTypeRecord | null } | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const list = q.data ?? [];

  function save(data: { name: string; hourlyRate: number }) {
    if (!canEdit || !dialog) return;
    setDialogError('');
    const editing = dialog.service;
    const opts = {
      onSuccess: (saved: ServiceTypeRecord) => {
        cache.setQueryData<ServiceTypeRecord[]>(getListServiceTypesQueryKey(), (old) =>
          [...(old ?? []).filter((s) => s.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
        refresh({ services: true }); setDialog(null);
        notify(editing ? 'Đã cập nhật dịch vụ. Ca đã ghi giữ nguyên mức trả công cũ.' : `Đã thêm dịch vụ ${data.name}.`);
      },
      onError: (e: unknown) => { setDialogError(errorText(e)); fail(e); },
    };
    if (editing) update.mutate({ id: editing.id, data }, opts);
    else create.mutate({ data }, opts);
  }
  function askDelete(s: ServiceTypeRecord) {
    if (!canEdit) return;
    setConfirm({
      title: `Xóa dịch vụ ${s.name}?`,
      body: <p>Chỉ xóa được dịch vụ chưa dùng trong ca nào. Nếu đã có ca dùng dịch vụ này, hệ thống sẽ từ chối để giữ nguyên lịch sử và lương đã tính.</p>,
      confirmLabel: 'Xóa dịch vụ',
      onConfirm: () => del.mutate({ id: s.id }, {
        onSuccess: () => { refresh({ services: true }); setConfirm(null); notify(`Đã xóa dịch vụ ${s.name}.`); },
        onError: (e) => {
          setConfirm(null);
          if (statusCode(e) === 409) fail({ data: { error: `Không thể xóa ${s.name}: dịch vụ đã được dùng trong ca phục vụ. Lịch sử được giữ nguyên — bạn có thể đổi tên hoặc giá cho ca mới.` } });
          else fail(e);
        },
      }),
    });
  }

  return (
    <section className={`panel${embedded ? '' : ' page'}`} aria-labelledby="svc-title" data-testid="section-services">
      {!embedded && <Link href="/" className="back" data-testid="link-back"><ArrowLeft size={15} />Trang chính</Link>}
      <div className="panel-head wrap">
        <div>{embedded ? <h2 id="svc-title">Dịch vụ &amp; bảng giá trả công</h2> : <h1 id="svc-title" className="page-title">Dịch vụ &amp; bảng giá trả công</h1>}<p className="sub">Giá / giờ dùng tính lương nhân viên, không phải giá bán thẻ. Đổi giá chỉ áp dụng cho ca mới.</p></div>
        {canEdit ? <button type="button" className="btn primary" onClick={() => { setDialogError(''); setDialog({ service: null }); }} data-testid="button-add-service"><Plus size={15} />Thêm dịch vụ</button>
      </div>
      {q.isLoading ? <Skeleton rows={4} label="Đang tải dịch vụ" /> : q.isError ? <ErrorBanner text="Không tải được danh mục dịch vụ." onRetry={() => void q.refetch()} /> : list.length === 0 ? (
        <div className="empty"><Sparkles size={22} /><p>Chưa có dịch vụ nào. Thêm dịch vụ để bắt đầu chấm công theo giờ.</p>
          {canEdit && <button type="button" className="btn primary" onClick={() => { setDialogError(''); setDialog({ service: null }); }}><Plus size={15} />Thêm dịch vụ đầu tiên</button>}</div>
      ) : (
        <ul className="emp-list" data-testid="list-services">
          {list.map((s) => (
            <li key={s.id} className="emp-row" data-testid={`row-service-${s.id}`}>
              <span className="grow"><strong>{s.name}</strong><span className="muted mono">{formatVnd(s.hourlyRate)} / giờ</span></span>
              {canEdit && (
                <span className="head-actions">
                  <button type="button" className="icon-btn" onClick={() => { setDialogError(''); setDialog({ service: s }); }} aria-label={`Sửa dịch vụ ${s.name}`} data-testid={`button-edit-service-${s.id}`}><Pencil size={15} /></button>
                  <button type="button" className="icon-btn danger" onClick={() => askDelete(s)} aria-label={`Xóa dịch vụ ${s.name}`} data-testid={`button-delete-service-${s.id}`}><Trash2 size={15} /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog && canEdit && <ServiceDialog service={dialog.service} busy={create.isPending || update.isPending} serverError={dialogError} onClose={() => setDialog(null)} onSubmit={save} />}
      {confirm && <ConfirmDialog state={confirm} busy={del.isPending} onClose={() => setConfirm(null)} />}
    </section>
  );
}

function ServiceDialog({ service, busy, serverError, onClose, onSubmit }: {
  service: ServiceTypeRecord | null; busy: boolean; serverError: string; onClose: () => void; onSubmit: (d: { name: string; hourlyRate: number }) => void;
}) {
  const [name, setName] = useState(service?.name ?? '');
  const [rate, setRate] = useState(service ? String(service.hourlyRate) : '');
  const [error, setError] = useState('');
  const money = parseMoney(rate);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Hãy nhập tên dịch vụ.');
    if (money === null || money < 1) return setError('Giá trả công theo giờ phải lớn hơn 0.');
    if (money > 10_000_000) return setError('Giá trả công tối đa 10.000.000 ₫ / giờ.');
    setError('');
    onSubmit({ name: name.trim(), hourlyRate: money });
  }
  const shown = error || serverError;
  return (
    <Modal title={service ? 'Sửa dịch vụ' : 'Thêm dịch vụ'} description={service ? 'Ca đã ghi giữ nguyên tên và mức trả công cũ.' : 'Giá trả công cho kỹ thuật viên mỗi giờ phục vụ.'} onClose={onClose} testId="dialog-service">
      <form className="form-grid" onSubmit={submit} noValidate>
        <label className="field" htmlFor="sv-name">Tên dịch vụ<input id="sv-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="Massage body đá nóng" data-testid="input-service-name" /></label>
        <label className="field" htmlFor="sv-rate">Giá trả công / giờ (VND)
          <input id="sv-rate" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} required placeholder="85000" data-testid="input-service-rate" />
          <span className="hint">{money ? `${formatVnd(money)} / giờ` : 'Nhập ví dụ 100000 hoặc 100.000.'}</span>
        </label>
        {shown && <p className="form-error" role="alert"><AlertCircle size={13} /> {shown}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy} data-testid="button-save-service">{busy && <LoaderCircle size={14} className="spin" />}Lưu</button>
        </div>
      </form>
    </Modal>
  );
}
