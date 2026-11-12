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
import { ArrowLeft, BookHeart, Building2, Check, Clock3, CreditCard, RefreshCw, ShieldAlert } from 'lucide-react';
import { Link } from 'wouter';
import { errorText } from '@/lib/massage';

type Product = 'personal' | 'business';
type Props = { product: Product; auth: AuthStatus; onGoBusiness?: () => void };

const money = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`;
const dateText = (date: string | null | undefined) => date
  ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(date))
  : 'Chưa có';

export function shouldGateSubscription(access: SubscriptionAccess | null | undefined) {
  if (!access) return false;
  if (access.status === 'blocked' || access.manualAccess === false) return true;
  return Boolean(access.billingEnabled && (!access.accessAllowed || access.status === 'expired'));
}

function stateLabel(status: SubscriptionPaymentRequest['status']) {
  return status === 'approved' ? 'Đã xác nhận' : status === 'rejected' ? 'Đã từ chối' : 'Chờ quản trị viên kiểm tra';
}

export function SubscriptionAccessScreen({ product, auth, onGoBusiness }: Props) {
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
    return <section className="panel subscription-loading" data-testid="subscription-loading">
      <span className="subscription-skeleton-line" /><span className="subscription-skeleton-line short" />
      <span className="subscription-skeleton-block" />
    </section>;
  }
  if (statusQuery.isError || !status) {
    return <section className="panel subscription-error" role="alert" data-testid="subscription-load-error">
      <ShieldAlert size={24} aria-hidden="true" /><h1>Chưa tải được trạng thái truy cập</h1>
      <p>Hãy thử tải lại thông tin trước khi tiếp tục.</p>
      <button className="btn" type="button" onClick={() => void statusQuery.refetch()} data-testid="button-retry-subscription">
        <RefreshCw size={15} aria-hidden="true" /> Thử lại
      </button>
    </section>;
  }

  const title = product === 'personal' ? 'Sổ chấm công cá nhân' : auth.businessName || 'Không gian doanh nghiệp';
  const verificationRequired = scope?.status === 'verification_required';
  const statusTitle = verificationRequired
    ? 'Cần xác minh email'
    : scope?.status === 'blocked' || scope?.manualAccess === false
      ? 'Quyền truy cập đang bị tạm dừng'
      : 'Thời hạn sử dụng đã kết thúc';
  return (
    <main className="subscription-page" data-testid={`screen-subscription-${product}`}>
      <div className="subscription-page-top">
        {product === 'personal'
          ? onGoBusiness
            ? <button type="button" className="subscription-back" onClick={onGoBusiness} data-testid="button-switch-to-business"><ArrowLeft size={16} aria-hidden="true" /> Về không gian doanh nghiệp</button>
            : <span className="subscription-back subscription-scope-label" data-testid="text-current-subscription-scope">Sổ cá nhân</span>
          : <Link href="/personal" className="subscription-back" data-testid="link-switch-subscription-scope">
            <ArrowLeft size={16} aria-hidden="true" /> Mở sổ cá nhân
          </Link>}
        <span className="subscription-mark">SỔ CÔNG <i>·</i> QUYỀN TRUY CẬP</span>
      </div>
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
          <p>{verificationRequired
            ? 'Hãy xác minh email đăng nhập rồi mở lại ứng dụng. Thời gian dùng thử cá nhân chỉ bắt đầu sau khi xác minh email.'
            : scope?.status === 'blocked' || scope?.manualAccess === false
              ? 'Quản trị viên đã tạm khóa riêng quyền truy cập của mục này. Thanh toán không tự gỡ quyết định khóa; vui lòng liên hệ quản trị viên.'
              : product === 'business'
                ? 'Quyền của doanh nghiệp được quản lý riêng với sổ cá nhân. Gia hạn mục này không thay đổi quyền sử dụng sổ cá nhân.'
                : 'Sổ cá nhân được quản lý độc lập với doanh nghiệp. Gia hạn sổ này không thay đổi quyền của bất kỳ cơ sở nào.'}</p>
          <div className="subscription-period" data-testid="text-subscription-period">
            <Clock3 size={15} aria-hidden="true" /> Hết hạn {dateText(scope?.paidUntil ?? scope?.trialEndsAt)}
          </div>
        </div>
        {employeeCannotPay ? (
          <div className="subscription-owner-note" role="status" data-testid="status-business-owner-renewal">
            <Building2 size={18} aria-hidden="true" /><span><strong>Chủ doanh nghiệp cần gia hạn</strong>
              <small>Tài khoản nhân viên không thể gửi yêu cầu thanh toán cho doanh nghiệp này. Hãy nhờ chủ cơ sở thực hiện.</small></span>
          </div>
        ) : !verificationRequired && scope?.billingEnabled && scope.accessAllowed === false && scope.status !== 'blocked' && scope.manualAccess !== false && (
          <div className="subscription-checkout">
            {status.paymentQrAvailable && qrUrl ? (
              <div className="subscription-qr-panel">
                <div className="subscription-qr-frame">
                  <img src={qrUrl} alt="Mã QR thanh toán Sổ Công" data-testid="img-subscription-payment-qr" />
                </div>
                <p>Quét mã để chuyển khoản, sau đó gửi yêu cầu xác nhận bên dưới.</p>
              </div>
            ) : (
              <div className="subscription-qr-unavailable" role="status" data-testid="status-subscription-qr-unavailable">
                <CreditCard size={19} aria-hidden="true" /><span>Chưa có mã QR thanh toán. Vui lòng liên hệ quản trị viên.</span>
              </div>
            )}
            <div className="subscription-plans">
              <h2>Chọn thời hạn</h2>
              <p>Phí chỉ áp dụng cho {product === 'personal' ? 'sổ cá nhân' : 'không gian doanh nghiệp'} này.</p>
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
              <p className="subscription-manual-note">Thanh toán được quản trị viên đối chiếu thủ công. Quyền chưa thay đổi cho đến khi yêu cầu được xác nhận.</p>
            </div>
          </div>
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
      <div className="subscription-bottom-note">Mỗi sản phẩm có thời hạn và quyền truy cập riêng.</div>
    </main>
  );
}
