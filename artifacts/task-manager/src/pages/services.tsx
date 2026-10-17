import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListServiceTypesQueryKey, useCreateServiceType, useDeleteServiceType, useListServiceTypes, useUpdateServiceType } from '@workspace/api-client-react';
import type { ServiceTypeRecord } from '@workspace/api-client-react';
import { AlertCircle, LoaderCircle, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import { useShell } from '@/components/app-shell';
import { ConfirmDialog, ErrorBanner, Modal, Skeleton, type ConfirmState } from '@/components/modal';
import { VoiceInput } from '@/components/voice-input';
import { statusCode } from '@/lib/attendance';
import { errorText, formatVnd, parseMoney, useRefreshMassage } from '@/lib/massage';

export default function ServicesPage() {
  return <ServiceCatalog />;
}

export function ServiceCatalog({ embedded = false }: { embedded?: boolean }) {
  const { canEditServices: canEdit, notify, fail } = useShell();
  const q = useListServiceTypes({ query: { queryKey: getListServiceTypesQueryKey(), staleTime: 20_000, refetchInterval: 60_000, refetchOnWindowFocus: true } });
  const create = useCreateServiceType();
  const update = useUpdateServiceType();
  const del = useDeleteServiceType();
  const refresh = useRefreshMassage();
  const cache = useQueryClient();
  const [dialog, setDialog] = useState<{ service: ServiceTypeRecord | null } | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const list = q.data ?? [];

  function save(data: { name: string; customerHourlyRate: number; hourlyRate: number }) {
    if (!canEdit || !dialog) return;
    setDialogError('');
    setLoginPrompt(false);
    const editing = dialog.service;
    const opts = {
      onSuccess: (saved: ServiceTypeRecord) => {
        cache.setQueryData<ServiceTypeRecord[]>(getListServiceTypesQueryKey(), (old) =>
          [...(old ?? []).filter((s) => s.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
        refresh({ services: true }); setDialog(null);
        notify(editing ? 'Đã cập nhật dịch vụ. Các ca đã ghi giữ nguyên tiền dịch vụ và tiền công cũ.' : `Đã thêm dịch vụ ${data.name}.`);
      },
      onError: (e: unknown) => {
        const code = statusCode(e);
        const message = code === 401
          ? 'Phiên đăng nhập chủ sở hữu không còn hiệu lực. Hãy đăng nhập lại để lưu dịch vụ.'
          : code === 403
            ? 'Tài khoản hiện tại không có quyền chỉnh sửa. Hãy dùng tài khoản chủ sở hữu.'
            : errorText(e);
        setLoginPrompt(code === 401 || code === 403);
        setDialogError(message);
        fail({ data: { error: message } });
      },
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
      <div className="panel-head wrap">
        <div>{embedded ? <h2 id="svc-title">Dịch vụ &amp; bảng giá</h2> : <h1 id="svc-title" className="page-title">Dịch vụ &amp; bảng giá</h1>}</div>
        {canEdit && <button type="button" className="btn primary" onClick={() => { setDialogError(''); setDialog({ service: null }); }} data-testid="button-add-service"><Plus size={15} />Thêm dịch vụ</button>}
      </div>
      {q.isLoading ? <Skeleton rows={4} label="Đang tải dịch vụ" /> : q.isError
        ? statusCode(q.error) === 401 || statusCode(q.error) === 403
          ? <div className="banner danger" role="alert">Chỉ chủ sở hữu mới được quản lý loại hình dịch vụ. <Link href="/sign-in" className="link-strong">Đăng nhập chủ sở hữu</Link></div>
          : <ErrorBanner text="Không tải được danh mục dịch vụ. Hãy thử tải lại." onRetry={() => void q.refetch()} />
        : list.length === 0 ? (
        <div className="empty"><Sparkles size={22} /><p>Chưa có dịch vụ nào.</p>
          {canEdit && <button type="button" className="btn primary" onClick={() => { setDialogError(''); setDialog({ service: null }); }}><Plus size={15} />Thêm dịch vụ đầu tiên</button>}</div>
      ) : (
        <ul className="emp-list" data-testid="list-services">
          {list.map((s) => (
            <li key={s.id} className="emp-row" data-testid={`row-service-${s.id}`}>
              <span className="grow"><strong>{s.name}</strong><span className="muted mono">Tiền dịch vụ: {s.customerHourlyRate > 0 ? `${formatVnd(s.customerHourlyRate)} / giờ` : 'chưa cài'} · Tiền công: {formatVnd(s.hourlyRate)} / giờ</span></span>
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
      {dialog && canEdit && <ServiceDialog service={dialog.service} busy={create.isPending || update.isPending} serverError={dialogError} authError={loginPrompt} onClose={() => setDialog(null)} onSubmit={save} />}
      {confirm && <ConfirmDialog state={confirm} busy={del.isPending} onClose={() => setConfirm(null)} />}
    </section>
  );
}

function ServiceDialog({ service, busy, serverError, authError, onClose, onSubmit }: {
  service: ServiceTypeRecord | null; busy: boolean; serverError: string; authError: boolean; onClose: () => void; onSubmit: (d: { name: string; customerHourlyRate: number; hourlyRate: number }) => void;
}) {
  const [name, setName] = useState(service?.name ?? '');
  const [customerRate, setCustomerRate] = useState(service ? String(service.customerHourlyRate) : '');
  const [employeeRate, setEmployeeRate] = useState(service ? String(service.hourlyRate) : '');
  const [error, setError] = useState('');
  const customerMoney = parseMoney(customerRate);
  const employeeMoney = parseMoney(employeeRate);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Hãy nhập tên dịch vụ.');
    if (customerMoney === null || customerMoney < 1) return setError('Tiền dịch vụ theo giờ phải lớn hơn 0.');
    if (employeeMoney === null || employeeMoney < 1) return setError('Tiền công nhân viên theo giờ phải lớn hơn 0.');
    if (customerMoney > 10_000_000 || employeeMoney > 10_000_000) return setError('Mỗi mức tiền tối đa 10.000.000 ₫ / giờ.');
    setError('');
    onSubmit({ name: name.trim(), customerHourlyRate: customerMoney, hourlyRate: employeeMoney });
  }
  const shown = error || serverError;
  return (
    <Modal title={service ? 'Sửa dịch vụ' : 'Thêm dịch vụ'} onClose={onClose} testId="dialog-service">
      <form className="form-grid" onSubmit={submit} noValidate>
        <label className="field" htmlFor="sv-name">Tên dịch vụ<VoiceInput id="sv-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="Massage body đá nóng" data-testid="input-service-name" /></label>
        <label className="field" htmlFor="sv-customer-rate">Tiền dịch vụ / giờ (VND)
          <input id="sv-customer-rate" inputMode="numeric" value={customerRate} onChange={(e) => setCustomerRate(e.target.value)} required placeholder="150000" data-testid="input-service-customer-rate" />
        </label>
        <label className="field" htmlFor="sv-employee-rate">Tiền công nhân viên / giờ (VND)
          <input id="sv-employee-rate" inputMode="numeric" value={employeeRate} onChange={(e) => setEmployeeRate(e.target.value)} required placeholder="85000" data-testid="input-service-employee-rate" />
        </label>
        {shown && <p className="form-error" role="alert"><AlertCircle size={13} /> {shown} {authError && <Link href="/sign-in" className="link-strong">Đăng nhập chủ sở hữu</Link>}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn primary" disabled={busy} data-testid="button-save-service">{busy && <LoaderCircle size={14} className="spin" />}Lưu</button>
        </div>
      </form>
    </Modal>
  );
}
