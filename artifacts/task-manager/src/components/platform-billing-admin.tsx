import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPlatformBillingSettingsQueryKey,
  getGetSubscriptionQrQueryKey,
  getListPlatformBillingAccountsQueryKey,
  getListPlatformPaymentRequestsQueryKey,
  getGetSubscriptionStatusQueryKey,
  useGetPlatformBillingSettings,
  useGetSubscriptionQr,
  useListPlatformBillingAccounts,
  useListPlatformPaymentRequests,
  useRenewPlatformSubscription,
  useReviewPlatformPaymentRequest,
  useUpdatePlatformBillingSettings,
  useUpdatePlatformBusinessAccess,
  useUpdatePlatformPersonalAccess,
  useUploadPlatformPaymentQr,
} from '@workspace/api-client-react';
import type { PlatformBillingAccount, SubscriptionAccess, SubscriptionPaymentRequest } from '@workspace/api-client-react';
import { AlertCircle, Building2, Check, ChevronLeft, ChevronRight, Clock3, CreditCard, Search, ShieldCheck, Upload, UserRound } from 'lucide-react';
import { errorText } from '@/lib/massage';
import { Modal } from '@/components/modal';

const PAGE_SIZE = 10;
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} ₫`;
const dateValue = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(value))
  : '—';

async function toPngUnderLimit(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Vui lòng chọn một tệp hình ảnh.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Ảnh gốc vượt quá 10 MB. Hãy chọn ảnh QR nhỏ hơn.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 6000 || bitmap.height > 6000 || bitmap.width * bitmap.height > 20_000_000) {
      throw new Error('Kích thước ảnh quá lớn. Hãy chọn ảnh QR nhỏ hơn.');
    }
    let scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Thiết bị không thể đọc hình ảnh này.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob && blob.size <= 1024 * 1024) return blob;
      scale *= 0.78;
    }
  } finally {
    bitmap.close();
  }
  throw new Error('Ảnh sau khi chuyển PNG vẫn lớn hơn 1 MB. Hãy chọn ảnh QR nhỏ hơn.');
}

function accessLabel(access: SubscriptionAccess) {
  if (!access.accessAllowed) return access.status === 'blocked' ? 'Đã khóa thủ công' : 'Không có quyền';
  if (access.status === 'trial') {
    const remaining = access.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(access.trialEndsAt).getTime() - Date.now()) / 86_400_000))
      : null;
    return `Dùng thử${remaining === null ? '' : ` · còn ${remaining} ngày`}`;
  }
  if (access.status === 'paid') return `Đã trả đến ${dateValue(access.paidUntil)}`;
  if (access.manualAccess) return 'Được cấp thủ công';
  if (access.status === 'expired') return 'Đã hết hạn';
  return access.billingEnabled ? 'Đang hoạt động' : 'Miễn phí';
}

function trialInfo(access: SubscriptionAccess) {
  if (!access.trialStartedAt && !access.trialEndsAt) return 'Chưa bắt đầu';
  const dates = access.trialStartedAt && access.trialEndsAt
    ? `${dateValue(access.trialStartedAt)} – ${dateValue(access.trialEndsAt)}`
    : dateValue(access.trialEndsAt || access.trialStartedAt);
  if (access.status === 'trial' && access.trialEndsAt) {
    const remaining = Math.max(0, Math.ceil((new Date(access.trialEndsAt).getTime() - Date.now()) / 86_400_000));
    return `${dates} · còn ${remaining} ngày`;
  }
  if (access.status === 'expired' && access.trialEndsAt) return `${dates} · đã hết hạn`;
  return dates;
}

type AccessSwitchProps = {
  id: string;
  label: string;
  access: SubscriptionAccess;
  disabled: boolean;
  onChange: (allowed: boolean) => void;
};

function AccessSwitch({ id, label, access, disabled, onChange }: AccessSwitchProps) {
  return <label className="billing-access-control" data-testid={`control-access-${id}`}>
    <span className="billing-access-copy"><strong>{label}</strong><small data-testid={`text-access-status-${id}`}>{accessLabel(access)}</small></span>
    <input type="checkbox" role="switch" checked={access.accessAllowed} disabled={disabled}
      onChange={(event) => onChange(event.target.checked)} data-testid={`switch-access-${id}`} aria-label={label} />
  </label>;
}

function AccessDetails({ id, title, access, busy, onChange, onRenew }: {
  id: string;
  title: string;
  access: SubscriptionAccess;
  busy: boolean;
  onChange: (allowed: boolean) => void;
  onRenew: (months: 1 | 6 | 12) => void;
}) {
  return <section className="billing-detail-scope" data-testid={`section-account-product-${id}`}>
    <header className="billing-detail-scope-heading">
      <div><strong>{title}</strong><span className={`billing-detail-status ${access.accessAllowed ? 'allowed' : 'blocked'}`}>{accessLabel(access)}</span></div>
    </header>
    <dl className="billing-detail-grid">
      <div><dt>Quyền sử dụng</dt><dd>{access.accessAllowed ? 'Được phép' : 'Đang bị chặn'}</dd></div>
      <div><dt>Trạng thái phí</dt><dd>{access.billingEnabled ? 'Đang bật' : 'Đang tắt · miễn phí'}</dd></div>
      <div><dt>Thời gian dùng thử</dt><dd>{trialInfo(access)}</dd></div>
      <div><dt>Đã thanh toán đến</dt><dd>{dateValue(access.paidUntil)}</dd></div>
      <div><dt>Quyền quản trị</dt><dd>{access.manualAccess === null ? 'Theo chính sách chung' : access.manualAccess ? 'Được cấp thủ công' : 'Bị thu hồi thủ công'}</dd></div>
    </dl>
    <div className="billing-detail-actions">
      <AccessSwitch id={id} label="Quyền sử dụng dịch vụ" access={access} disabled={busy} onChange={onChange} />
      <RenewActions prefix={id} disabled={busy} onChoose={onRenew} />
    </div>
  </section>;
}

function AccountRow({ account, busy, isOpen, onOpenChange, updatePersonal, updateBusiness, renew }: {
  account: PlatformBillingAccount;
  busy: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  updatePersonal: (userId: string, allowed: boolean) => void;
  updateBusiness: (businessId: string, allowed: boolean) => void;
  renew: (product: 'personal' | 'business', months: 1 | 6 | 12, userId?: string, businessId?: string) => void;
}) {
  const dialogTitle = account.name || account.email || 'Tài khoản ứng dụng';
  return <>
    <article className="billing-account" data-testid={`card-billing-account-${account.userId}`}>
      <button type="button" className="billing-account-head-button" aria-haspopup="dialog"
        aria-label={`Xem chi tiết tài khoản ${dialogTitle}`}
        onClick={() => onOpenChange(!isOpen)} data-testid={`button-open-billing-account-${account.userId}`}>
        <span className="billing-avatar">{account.name.trim().charAt(0).toLocaleUpperCase('vi-VN') || 'T'}</span>
        <span className="billing-account-identity">
          <strong data-testid={`text-billing-account-name-${account.userId}`}>{account.name}</strong>
          <small data-testid={`text-billing-account-email-${account.userId}`}>{account.email || 'Chưa có email'} · Tạo ngày {dateValue(account.createdAt)}</small>
          <small className="billing-account-summary">Sổ cá nhân: {accessLabel(account.personal)} · {account.businesses.length} cơ sở</small>
        </span>
        <span className="billing-account-id">Xem chi tiết</span>
        <ChevronRight size={16} className={isOpen ? 'billing-account-chevron open' : 'billing-account-chevron'} aria-hidden="true" />
      </button>
    </article>
    {isOpen && <Modal title={dialogTitle} description="Thông tin dịch vụ, thời hạn dùng thử và quyền truy cập của tài khoản này."
      onClose={() => onOpenChange(false)} testId={`dialog-billing-account-${account.userId}`} className="billing-account-details-dialog">
      <div className="billing-account-detail-meta">
        <span>{account.email || 'Chưa có email'}</span>
        <span>Tạo tài khoản: {dateValue(account.createdAt)}</span>
        <span title={account.userId}>Mã tài khoản: {account.userId}</span>
      </div>
      <div className="billing-account-detail-list">
        <AccessDetails id={`personal-${account.userId}`} title="Sổ cá nhân" access={account.personal} busy={busy}
          onChange={(allowed) => updatePersonal(account.userId, allowed)}
          onRenew={(months) => renew('personal', months, account.userId)} />
        {account.businesses.length ? account.businesses.map((business) => <AccessDetails key={business.id}
          id={`business-${business.id}`} title={`${business.name} · ${business.role === 'owner' ? 'Chủ doanh nghiệp' : 'Nhân viên'}`}
          access={business.access} busy={busy} onChange={(allowed) => updateBusiness(business.id, allowed)}
          onRenew={(months) => renew('business', months, undefined, business.id)} />)
          : <div className="billing-empty compact" data-testid={`empty-account-businesses-${account.userId}`}>
            <Building2 size={18} aria-hidden="true" /><strong>Chưa tham gia cơ sở nào</strong>
          </div>}
      </div>
    </Modal>}
  </>;
}

function RenewActions({ prefix, disabled, onChoose }: {
  prefix: string;
  disabled: boolean;
  onChoose: (months: 1 | 6 | 12) => void;
}) {
  return <div className="billing-renew-actions" aria-label="Cấp thêm thời hạn">
    {[1, 6, 12].map((months) => <button key={months} type="button" className="btn small" disabled={disabled}
      onClick={() => onChoose(months as 1 | 6 | 12)} data-testid={`button-renew-${prefix}-${months}`}>
      +{months} tháng
    </button>)}
  </div>;
}

function RequestRow({ request, busy, review }: {
  request: SubscriptionPaymentRequest;
  busy: boolean;
  review: (requestId: string, decision: 'approved' | 'rejected') => void;
}) {
  return <article className="billing-payment-request" data-testid={`card-platform-payment-request-${request.id}`}>
    <div className="billing-request-main">
      <span className="billing-request-icon"><CreditCard size={16} aria-hidden="true" /></span>
      <div><strong>{request.product === 'personal' ? 'Sổ cá nhân' : request.businessName || 'Doanh nghiệp'} · {request.months} tháng</strong>
        <small>{money(request.amountVnd)} · {dateValue(request.createdAt)} · {request.userId}</small></div>
    </div>
    <div className="billing-request-actions">
      <button type="button" className="btn small primary" disabled={busy} onClick={() => review(request.id, 'approved')} data-testid={`button-approve-payment-${request.id}`}>
        <Check size={14} aria-hidden="true" /> Xác nhận
      </button>
      <button type="button" className="btn small" disabled={busy} onClick={() => review(request.id, 'rejected')} data-testid={`button-reject-payment-${request.id}`}>Từ chối</button>
    </div>
  </article>;
}

export function PlatformBillingAdmin({ view }: { view: 'accounts' | 'billing' }) {
  const cache = useQueryClient();
  const settingsQuery = useGetPlatformBillingSettings({ query: { enabled: view === 'billing', queryKey: getGetPlatformBillingSettingsQueryKey() } });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const params = useMemo(() => ({ query: search || undefined, limit: PAGE_SIZE, offset }), [search, offset]);
  const accountsQuery = useListPlatformBillingAccounts(params, {
    query: { enabled: view === 'accounts', queryKey: getListPlatformBillingAccountsQueryKey(params) },
  });
  const requestsQuery = useListPlatformPaymentRequests({ status: 'pending' }, {
    query: { enabled: view === 'billing', queryKey: getListPlatformPaymentRequestsQueryKey({ status: 'pending' }) },
  });
  const qrQuery = useGetSubscriptionQr({
    query: { enabled: view === 'billing' && settingsQuery.data?.qrAvailable === true, queryKey: getGetSubscriptionQrQueryKey() },
  });
  const qrUrl = useMemo(() => qrQuery.data ? URL.createObjectURL(qrQuery.data) : '', [qrQuery.data]);
  useEffect(() => () => { if (qrUrl) URL.revokeObjectURL(qrUrl); }, [qrUrl]);
  useEffect(() => { setSelectedAccountId(null); }, [search, offset]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const settingsMutation = useUpdatePlatformBillingSettings();
  const uploadMutation = useUploadPlatformPaymentQr();
  const personalMutation = useUpdatePlatformPersonalAccess();
  const businessMutation = useUpdatePlatformBusinessAccess();
  const renewMutation = useRenewPlatformSubscription();
  const reviewMutation = useReviewPlatformPaymentRequest();
  const busy = settingsMutation.isPending || uploadMutation.isPending || personalMutation.isPending ||
    businessMutation.isPending || renewMutation.isPending || reviewMutation.isPending;

  function clearMessages() { setMessage(''); setError(''); }
  function fail(caught: unknown) { setMessage(''); setError(errorText(caught)); }
  async function refreshBillingData() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: getListPlatformBillingAccountsQueryKey() }),
      cache.invalidateQueries({ queryKey: getListPlatformPaymentRequestsQueryKey() }),
      cache.invalidateQueries({ queryKey: getGetPlatformBillingSettingsQueryKey() }),
      cache.invalidateQueries({ queryKey: getGetSubscriptionStatusQueryKey() }),
    ]);
  }
  function updateSwitch(key: 'businessBillingEnabled' | 'personalBillingEnabled', checked: boolean) {
    clearMessages();
    settingsMutation.mutate({ data: { [key]: checked } }, {
      onSuccess: async () => { setMessage('Đã cập nhật cài đặt phí.'); await refreshBillingData(); },
      onError: fail,
    });
  }
  async function uploadQr(file?: File) {
    if (!file) return;
    clearMessages();
    try {
      const png = await toPngUnderLimit(file);
      uploadMutation.mutate({ data: png }, {
        onSuccess: async () => {
          setMessage('Mã QR đã được cập nhật.');
          await Promise.all([
            cache.invalidateQueries({ queryKey: getGetPlatformBillingSettingsQueryKey() }),
            cache.invalidateQueries({ queryKey: getGetSubscriptionQrQueryKey() }),
          ]);
        },
        onError: fail,
      });
    } catch (caught) { fail(caught); }
  }
  function changePersonal(userId: string, allowed: boolean) {
    clearMessages();
    personalMutation.mutate({ userId, data: { allowed } }, {
      onSuccess: async () => { setMessage(allowed ? 'Đã mở quyền cá nhân.' : 'Đã khóa quyền cá nhân.'); await refreshBillingData(); },
      onError: fail,
    });
  }
  function changeBusiness(businessId: string, allowed: boolean) {
    clearMessages();
    businessMutation.mutate({ businessId, data: { allowed } }, {
      onSuccess: async () => { setMessage(allowed ? 'Đã mở quyền cơ sở.' : 'Đã khóa quyền cơ sở.'); await refreshBillingData(); },
      onError: fail,
    });
  }
  function renew(product: 'personal' | 'business', months: 1 | 6 | 12, userId?: string, businessId?: string) {
    clearMessages();
    renewMutation.mutate({ data: { product, months, ...(userId ? { userId } : {}), ...(businessId ? { businessId } : {}) } }, {
      onSuccess: async () => { setMessage(`Đã cấp thêm ${months} tháng cho ${product === 'personal' ? 'sổ cá nhân' : 'doanh nghiệp'}.`); await refreshBillingData(); },
      onError: fail,
    });
  }
  function review(requestId: string, decision: 'approved' | 'rejected') {
    clearMessages();
    reviewMutation.mutate({ requestId, data: { decision } }, {
      onSuccess: async () => {
        setMessage(decision === 'approved' ? 'Đã xác nhận thanh toán thủ công.' : 'Đã từ chối yêu cầu thanh toán.');
        await refreshBillingData();
      },
      onError: fail,
    });
  }
  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim().slice(0, 120));
  }

  if (view === 'billing' && settingsQuery.isPending) return <div className="billing-loading" data-testid="platform-billing-loading">
    <span /><span /><span />
  </div>;
  if (view === 'billing' && (settingsQuery.isError || !settingsQuery.data)) return <section className="billing-admin-error" role="alert" data-testid="platform-billing-load-error">
    <AlertCircle size={18} aria-hidden="true" />Không tải được thiết lập thanh toán.
    <button type="button" className="btn small" onClick={() => void settingsQuery.refetch()} data-testid="button-retry-platform-billing">Thử lại</button>
  </section>;
  const settings = settingsQuery.data;
  const accounts = accountsQuery.data;
  const requests = requestsQuery.data ?? [];
  return <section className="platform-billing-admin" aria-labelledby="platform-billing-title" data-testid="platform-billing-admin">
    <header className="billing-admin-heading">
      <div className="billing-admin-emblem"><ShieldCheck size={20} aria-hidden="true" /></div>
      <div><span className="billing-admin-kicker">QUẢN TRỊ NỀN TẢNG</span>
        <h3 id="platform-billing-title">{view === 'accounts' ? 'Quản lý tài khoản người dùng' : 'Phí và thanh toán'}</h3>
        <p>{view === 'accounts'
          ? 'Chọn tài khoản để xem thời hạn dùng thử, dịch vụ và quyền truy cập.'
          : 'Chính sách phí, mã QR và xác nhận giao dịch được kiểm soát riêng.'}</p></div>
    </header>
    {error && <div className="billing-notice error" role="alert" data-testid="status-platform-billing-error">{error}</div>}
    {message && <div className="billing-notice success" role="status" data-testid="status-platform-billing-success"><Check size={14} />{message}</div>}
    {view === 'billing' && settings && <section className="billing-admin-section">
      <div className="billing-section-heading"><div><span>01</span><h4>Chính sách phí</h4></div><small>Thời gian dùng thử: <strong data-testid="text-billing-trial-days">{settings.trialDays} ngày</strong></small></div>
      <div className="billing-settings-switches">
        <label className="billing-toggle-card" data-testid="control-business-billing">
          <span className="billing-toggle-symbol"><Building2 size={17} aria-hidden="true" /></span>
          <span><strong>Phí doanh nghiệp</strong><small>100.000 ₫/tháng · 1.000.000 ₫/năm</small></span>
           <input type="checkbox" role="switch" checked={settings.businessBillingEnabled} disabled={busy || !settings.qrAvailable}
            onChange={(event) => updateSwitch('businessBillingEnabled', event.target.checked)} data-testid="switch-business-billing" />
        </label>
        <label className="billing-toggle-card" data-testid="control-personal-billing">
          <span className="billing-toggle-symbol personal"><UserRound size={17} aria-hidden="true" /></span>
          <span><strong>Phí sổ cá nhân</strong><small>20.000 ₫/tháng · 200.000 ₫/năm</small></span>
           <input type="checkbox" role="switch" checked={settings.personalBillingEnabled} disabled={busy || !settings.qrAvailable}
            onChange={(event) => updateSwitch('personalBillingEnabled', event.target.checked)} data-testid="switch-personal-billing" />
        </label>
      </div>
      <p className="billing-policy-note">{settings.qrAvailable
        ? 'Tắt thu phí sẽ ngừng áp dụng phí, không xóa ngày dùng thử, thời hạn đã trả hoặc quyền bị thu hồi thủ công.'
        : 'Tải mã QR trước khi bật thu phí để người dùng có thể gửi yêu cầu thanh toán.'}</p>
    </section>}
    {view === 'billing' && settings && <section className="billing-admin-section">
      <div className="billing-section-heading"><div><span>02</span><h4>Mã QR nhận thanh toán</h4></div>
        <span className={`billing-qr-status ${settings.qrAvailable ? 'ready' : ''}`} data-testid="status-platform-qr">{settings.qrAvailable ? 'Đã có mã QR' : 'Chưa tải mã QR'}</span>
      </div>
      <div className="billing-qr-manager">
        {qrUrl ? <div className="billing-qr-preview"><img src={qrUrl} alt="Mã QR thanh toán hiện tại" data-testid="img-platform-payment-qr" /></div> :
          <div className="billing-qr-empty" data-testid="platform-qr-preview-empty"><CreditCard size={23} aria-hidden="true" /><span>Ảnh QR sẽ hiển thị tại đây</span></div>}
        <div className="billing-qr-copy"><strong>Ảnh PNG tối đa 1 MB</strong><p>Ảnh được chuyển sang PNG trong trình duyệt trước khi tải lên.</p>
          <label className="btn small billing-upload-button"><Upload size={14} aria-hidden="true" />{uploadMutation.isPending ? 'Đang tải…' : 'Chọn ảnh QR'}
            <input type="file" accept="image/*" disabled={busy} onChange={(event) => { void uploadQr(event.target.files?.[0]); event.currentTarget.value = ''; }} data-testid="input-platform-payment-qr" />
          </label>
          {qrQuery.isError && <p className="billing-inline-error" role="alert" data-testid="status-platform-qr-load-error">Không tải được ảnh QR. Hãy thử lại.</p>}
        </div>
      </div>
    </section>}
    {view === 'accounts' && <section className="billing-admin-section">
      <div className="billing-section-heading"><div><span>01</span><h4>Tất cả tài khoản ứng dụng</h4></div>
        <span className="billing-total-count" data-testid="text-billing-account-count">{accounts?.totalCount ?? 0} tài khoản</span></div>
      <p className="billing-policy-note" data-testid="text-all-app-accounts">
        Danh sách gồm toàn bộ tài khoản đã đăng ký ứng dụng. Chọn một tài khoản để xem trạng thái gói và quản lý quyền.
      </p>
      <form className="billing-search" onSubmit={applySearch} role="search">
        <Search size={16} aria-hidden="true" /><label className="sr-only" htmlFor="billing-account-search">Tìm tài khoản</label>
        <input id="billing-account-search" value={searchInput} maxLength={120} onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Tìm theo tên, email hoặc mã tài khoản" data-testid="input-billing-account-search" />
        <button type="submit" className="btn small" data-testid="button-search-billing-accounts">Tìm</button>
      </form>
      {accountsQuery.isLoading ? <div className="billing-account-skeleton" data-testid="billing-accounts-loading"><span /><span /><span /></div> :
        accountsQuery.isError ? <div className="billing-query-error" role="alert" data-testid="billing-accounts-error">Không tải được danh sách tài khoản.
          <button type="button" onClick={() => void accountsQuery.refetch()} data-testid="button-retry-billing-accounts">Thử lại</button></div> :
          !accounts?.items.length ? <div className="billing-empty" data-testid="billing-accounts-empty">
            <UserRound size={20} aria-hidden="true" /><strong>Không tìm thấy tài khoản</strong><span>Thử từ khóa khác hoặc xóa bộ lọc tìm kiếm.</span>
          </div> : <div className="billing-account-list">
          {accounts.items.map((account) => <AccountRow key={account.userId} account={account} busy={busy}
              isOpen={selectedAccountId === account.userId} onOpenChange={(open) => setSelectedAccountId(open ? account.userId : null)}
              updatePersonal={changePersonal} updateBusiness={changeBusiness} renew={renew} />)}
          </div>}
      {accounts && accounts.totalCount > PAGE_SIZE && <nav className="billing-pagination" aria-label="Phân trang tài khoản">
        <span data-testid="text-billing-page">{offset + 1}–{Math.min(offset + PAGE_SIZE, accounts.totalCount)} / {accounts.totalCount}</span>
        <button className="btn small" type="button" disabled={offset <= 0 || accountsQuery.isFetching}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} data-testid="button-billing-page-previous"><ChevronLeft size={14} />Trước</button>
        <button className="btn small" type="button" disabled={offset + PAGE_SIZE >= accounts.totalCount || accountsQuery.isFetching}
          onClick={() => setOffset(offset + PAGE_SIZE)} data-testid="button-billing-page-next">Tiếp<ChevronRight size={14} /></button>
      </nav>}
    </section>}
    {view === 'billing' && <section className="billing-admin-section">
      <div className="billing-section-heading"><div><span>04</span><h4>Yêu cầu thanh toán</h4></div>
        <span className="billing-pending-count" data-testid="text-pending-payment-count"><Clock3 size={13} />{requests.length} chờ kiểm tra</span></div>
      {requestsQuery.isLoading ? <div className="billing-request-skeleton" data-testid="payment-requests-admin-loading"><span /><span /></div> :
        requestsQuery.isError ? <div className="billing-query-error" role="alert" data-testid="payment-requests-admin-error">Không tải được yêu cầu thanh toán.
          <button type="button" onClick={() => void requestsQuery.refetch()} data-testid="button-retry-platform-payment-requests">Thử lại</button></div> :
          requests.length === 0 ? <div className="billing-empty compact" data-testid="platform-payment-requests-empty">
            <Check size={18} aria-hidden="true" /><strong>Không có yêu cầu chờ</strong><span>Các yêu cầu mới sẽ xuất hiện tại đây để quản trị viên đối chiếu.</span>
          </div> : <div className="billing-request-list">
            {requests.map((request) => <RequestRow key={request.id} request={request} busy={busy} review={review} />)}
          </div>}
      <p className="billing-manual-review-note">Chỉ xác nhận sau khi đã đối chiếu khoản chuyển khoản. Không có bước xác nhận thanh toán tự động.</p>
    </section>}
  </section>;
}
