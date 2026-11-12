import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetSubscriptionQrQueryKey,
  getGetSubscriptionStatusQueryKey,
  getListMySubscriptionPaymentRequestsQueryKey,
  useCreateSubscriptionPaymentRequest,
  useGetSubscriptionQr,
  useGetSubscriptionStatus,
  useListMySubscriptionPaymentRequests,
} from '@workspace/api-client-react';
import type { AuthStatus, SubscriptionAccess, SubscriptionPaymentRequest } from '@workspace/api-client-react';
import { ArrowLeft, Building2, Check, Clock3, CreditCard, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { Link } from 'wouter';
import { errorText } from '@/lib/massage';

type Product = 'personal' | 'business';
type Props = { product: Product; auth: AuthStatus; onGoBusiness?: () => void; onSignOut: () => void };

const money = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`;
const dateText = (date: string | null | undefined) => date
  ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(date))
  : 'Chưa có';

export function shouldGateSubscription(access: SubscriptionAccess | null | undefined) {
  if (!access) return false;
  if (access.status === 'blocked' || access.manualAccess === false) return true;
  return Boolean(access.billingEnabled && (!access.accessAllowed || access.status === 'expired'));
}

function SubscriptionPageHeader({
  product,
  onGoBusiness,
  onSignOut,
}: Pick<Props, 'product' | 'onGoBusiness' | 'onSignOut'>) {
  return (
    <div className="subscription-page-top">
      {product === 'personal'
        ? onGoBusiness
          ? <button type="button" className="subscription-back" onClick={onGoBusiness} data-testid="button-switch-to-business">
              <ArrowLeft size={16} aria-hidden="true" /> Doanh nghiệp
            </button>
          : <span className="subscription-back subscription-scope-label" data-testid="text-current-subscription-scope">Sổ cá nhân</span>
        : <Link href="/personal" className="subscription-back" data-testid="link-switch-subscription-scope">
            <ArrowLeft size={16} aria-hidden="true" /> Sổ cá nhân
          </Link>}
      <span className="subscription-mark">SỔ CÔNG</span>
      <button type="button" className="subscription-signout" onClick={onSignOut} data-testid="button-subscription-sign-out">
        <LogOut size={16} aria-hidden="true" /> Đăng xuất
      </button>
    </div>
  );
}

function stateLabel(status: SubscriptionPaymentRequest['status']) {
  return status === 'approved' ? 'Đã xác nhận' : status === 'rejected' ? 'Đã từ chối' : 'Chờ quản trị viên kiểm tra';
}

export function SubscriptionAccessScreen({ product, auth, onGoBusiness, onSignOut }: Props) {
  const cache = useQueryClient();
  const statusQuery = useGetSubscriptionStatus({
    query: { queryKey: [...getGetSubscriptionStatusQueryKey(), auth.userId ?? 'account', auth.businessId ?? 'personal'] },
  });
  const requestQuery = useListMySubscriptionPaymentRequests({
    query: { queryKey: getListMySubscriptionPaymentRequestsQueryKey() },
  });
  const status = statusQuery.data;
  const scope = product === 'personal' ? status?.personal : status?.business;
  const qrQuery = useGetSubscriptionQr({
    query: { enabled: Boolean(status?.paymentQrAvailable), queryKey: getGetSubscriptionQrQueryKey() },
  });
  const qrUrl = useMemo(() => qrQuery.data ? URL.createObjectURL(qrQuery.data) : '', [qrQuery.data]);
  useEffect(() => () => { if (qrUrl) URL.revokeObjectURL(qrUrl); }, [qrUrl]);
  const createRequest = useCreateSubscriptionPaymentRequest();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedBusiness = auth.businesses.find((business) => business.id === auth.businessId);
  const employeeCannotPay = product === 'business' &&
    (selectedBusiness?.role === 'employee' || auth.role === 'employee') && !auth.isPlatformAdmin;
  const monthly = product === 'business' ? status?.prices.businessMonthly ?? 100000 : status?.prices.personalMonthly ?? 20000;
  const yearly = product === 'business' ? status?.prices.businessYearly ?? 1000000 : status?.prices.personalYearly ?? 200000;
  const recentRequests = (requestQuery.data ?? []).filter((request) => request.product === product &&
    (product !== 'business' || request.businessId === auth.businessId));
  const pending = recentRequests.some((request) => request.status === 'pending');

  async function requestPayment(months: 1 | 12) {
    if (!scope?.billingEnabled || !status?.paymentQrAvailable || employeeCannotPay || pending || createRequest.isPending) return;
    setError('');
    setNotice('');
    const data = {
      product,
      months,
      ...(product === 'business' && auth.businessId ? { businessId: auth.businessId } : {}),
      idempotencyKey: crypto.randomUUID(),
    } as const;
    createRequest.mutate({ data }, {
      onSuccess: async () => {
        setNotice('Đã gửi yêu cầu. Quản trị viên sẽ kiểm tra giao dịch và cập nhật quyền truy cập.');
        await Promise.all([
          cache.invalidateQueries({ queryKey: getListMySubscriptionPaymentRequestsQueryKey() }),
          cache.invalidateQueries({ queryKey: getGetSubscriptionStatusQueryKey() }),
        ]);
      },
      onError: (caught) => setError(errorText(caught)),
    });
  }

  if (statusQuery.isPending) {
    return <main className="subscription-page" data-testid={`screen-subscription-${product}`}>
      <SubscriptionPageHeader product={product} onGoBusiness={onGoBusiness} onSignOut={onSignOut} />
      <section className="panel subscription-loading" aria-busy="true" data-testid="subscription-loading">
        <span className="subscription-skeleton-line" /><span className="subscription-skeleton-line short" />
        <span className="subscription-skeleton-block" />
      </section>
    </main>;
  }
  if (statusQuery.isError || !status) {
    return <main className="subscription-page" data-testid={`screen-subscription-${product}`}>
      <SubscriptionPageHeader product={product} onGoBusiness={onGoBusiness} onSignOut={onSignOut} />
      <section className="panel subscription-error" role="alert" data-testid="subscription-load-error">
        <ShieldAlert size={24} aria-hidden="true" /><h1>Chưa tải được trạng thái truy cập</h1>
        <p>Thử tải lại hoặc đăng xuất.</p>
        <button className="btn" type="button" onClick={() => void statusQuery.refetch()} data-testid="button-retry-subscription">
          <RefreshCw size={15} aria-hidden="true" /> Thử lại
        </button>
      </section>
    </main>;
  }

  const title = product === 'personal' ? 'Sổ chấm công cá nhân' : auth.businessName || 'Không gian doanh nghiệp';
  const verificationRequired = scope?.status === 'verification_required';
  const manuallyBlocked = scope?.status === 'blocked' || scope?.manualAccess === false;
  const statusTitle = verificationRequired
    ? 'Cần xác minh email'
    : manuallyBlocked
      ? 'Quyền truy cập bị tắt'
      : 'Thời hạn sử dụng đã hết';
  const statusMessage = verificationRequired
    ? 'Hãy xác minh email để tiếp tục sử dụng.'
    : manuallyBlocked
      ? 'Quyền truy cập đã bị tắt. Liên hệ quản trị viên để mở lại.'
      : 'Thời hạn dùng thử hoặc gói đã hết. Chọn gói để gia hạn.';
  return (
    <main className="subscription-page" data-testid={`screen-subscription-${product}`}>
      <SubscriptionPageHeader product={product} onGoBusiness={onGoBusiness} onSignOut={onSignOut} />
      <section className="subscription-card">
        <div className="subscription-card-heading">
          <span className="subscription-alert-icon"><ShieldAlert size={22} aria-hidden="true" /></span>
          <div>
            <span className="subscription-kicker">{product === 'personal' ? 'SỔ CÁ NHÂN' : 'DOANH NGHIỆP'}</span>
            <h1 data-testid="text-subscription-title">{statusTitle}</h1>
            <p data-testid="text-subscription-scope">{title}</p>
          </div>
        </div>
        <div className="subscription-explainer">
          <p>{statusMessage}</p>
          {(scope?.paidUntil || scope?.trialEndsAt) && (
            <div className="subscription-period" data-testid="text-subscription-period">
              <Clock3 size={16} aria-hidden="true" /> Hết hạn {dateText(scope?.paidUntil ?? scope?.trialEndsAt)}
            </div>
          )}
        </div>
        {!verificationRequired && (
          <section className="subscription-upgrade" aria-labelledby="subscription-upgrade-title" data-testid="section-subscription-upgrade">
            <div className="subscription-upgrade-heading">
              <h2 id="subscription-upgrade-title">Nâng cấp tài khoản</h2>
              {manuallyBlocked
                ? <p>Cần mở lại quyền trước khi thanh toán.</p>
                : <p>Chọn thời hạn sử dụng.</p>}
            </div>
            {manuallyBlocked ? (
              <p className="subscription-admin-block-note" role="status" data-testid="status-subscription-manual-block">
                {employeeCannotPay
                  ? 'Quản trị viên cần mở lại quyền; nhân viên không thể tự yêu cầu thanh toán.'
                  : 'Thanh toán không tự mở khóa tài khoản.'}
              </p>
            ) : employeeCannotPay ? (
              <div className="subscription-owner-note" role="status" data-testid="status-business-owner-renewal">
                <Building2 size={18} aria-hidden="true" /><span><strong>Chủ doanh nghiệp cần nâng cấp</strong>
                  <small>Nhờ chủ cơ sở gia hạn gói doanh nghiệp.</small></span>
              </div>
            ) : scope?.billingEnabled ? (
              <div className="subscription-checkout">
                {status.paymentQrAvailable && qrUrl ? (
                  <div className="subscription-qr-panel">
                    <div className="subscription-qr-frame">
                      <img src={qrUrl} alt="Mã QR thanh toán Sổ Công" data-testid="img-subscription-payment-qr" />
                    </div>
                    <p>Quét mã QR để thanh toán.</p>
                  </div>
                ) : (
                  <div className="subscription-qr-unavailable" role="status" data-testid="status-subscription-qr-unavailable">
                    <CreditCard size={19} aria-hidden="true" /><span>Chưa có mã thanh toán. Liên hệ quản trị viên.</span>
                  </div>
                )}
                <div className="subscription-plans">
                  <div className="subscription-plan-row">
                    <div><strong>1 tháng</strong><small>{money(monthly)}</small></div>
                    <button className="btn primary" type="button" disabled={createRequest.isPending || pending || !status.paymentQrAvailable}
                      onClick={() => void requestPayment(1)} data-testid={`button-request-${product}-monthly`}>
                      {createRequest.isPending ? 'Đang gửi…' : 'Gửi yêu cầu'}
                    </button>
                  </div>
                  <div className="subscription-plan-row featured">
                    <div><strong>12 tháng</strong><small>{money(yearly)} <em>· tiết kiệm theo năm</em></small></div>
                    <button className="btn primary" type="button" disabled={createRequest.isPending || pending || !status.paymentQrAvailable}
                      onClick={() => void requestPayment(12)} data-testid={`button-request-${product}-yearly`}>
                      {createRequest.isPending ? 'Đang gửi…' : 'Gửi yêu cầu'}
                    </button>
                  </div>
                  <p className="subscription-manual-note">Quản trị viên xác nhận yêu cầu thanh toán.</p>
                </div>
              </div>
            ) : (
              <p className="subscription-admin-block-note" role="status" data-testid="status-subscription-billing-disabled">
                Thanh toán trực tuyến hiện chưa được bật. Liên hệ quản trị viên để nâng cấp.
              </p>
            )}
          </section>
        )}
        {error && <p className="subscription-message error" role="alert" data-testid="status-subscription-error">{error}</p>}
        {notice && <p className="subscription-message success" role="status" data-testid="status-subscription-success"><Check size={15} />{notice}</p>}
        <section className="subscription-history">
          <div className="subscription-history-head"><h2>Lịch sử yêu cầu</h2>
            <button type="button" className="link-soft as-button" onClick={() => void requestQuery.refetch()} data-testid="button-refresh-payment-requests">Cập nhật</button></div>
          {requestQuery.isLoading ? <div className="subscription-history-skeleton" data-testid="payment-requests-loading" /> :
            requestQuery.isError ? <div className="subscription-request-error" role="alert" data-testid="payment-requests-error">
              Không tải được yêu cầu. <button type="button" onClick={() => void requestQuery.refetch()} data-testid="button-retry-payment-requests">Thử lại</button>
            </div> : recentRequests.length === 0 ? <p className="subscription-history-empty" data-testid="payment-requests-empty">Chưa có yêu cầu thanh toán cho mục này.</p> :
              recentRequests.map((request) => <div className="subscription-request-row" key={request.id} data-testid={`row-payment-request-${request.id}`}>
                <span><strong>{request.months} tháng</strong><small>{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(request.createdAt))} · {money(request.amountVnd)}</small></span>
                <span className={`subscription-request-status ${request.status}`} data-testid={`status-payment-request-${request.id}`}>{request.status === 'pending' ? <Clock3 size={13} /> : <Check size={13} />}{stateLabel(request.status)}</span>
              </div>)}
        </section>
      </section>
    </main>
  );
}
