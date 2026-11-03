import { useMemo, useState } from 'react';
import { getGetMassageSummaryQueryKey, useGetMassageSummary } from '@workspace/api-client-react';
import { ArrowRight, CalendarDays, CreditCard, Sparkles, Users } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { useShell } from '@/components/app-shell';
import { ErrorBanner } from '@/components/modal';
import { formatShortDate, statusCode } from '@/lib/attendance';
import { formatMinutes, formatMonth, formatVnd } from '@/lib/massage';
import { serviceDurationLabel, type ServiceDurationDetail } from '@/lib/service-duration-summary';
import { resolveRevenuePeriod } from '@/lib/revenue-period';
import { useVietnamToday } from '@/lib/use-vietnam-today';
import { PaymentDetailsDialog } from '@/components/payment-details-dialog';
import './revenue-history.css';
import './payment-report.css';

type PaymentMethodFilter = 'cash' | 'transfer' | 'unrecorded';

function PaymentReportRow({ label, amount, method, testId, onSelect }: {
  label: string;
  amount: number;
  method: PaymentMethodFilter;
  testId: string;
  onSelect: (method: PaymentMethodFilter) => void;
}) {
  return (
    <div className="payment-report-row">
      <dt>{label}</dt>
      <dd>
        <button type="button" className="payment-report-trigger mono" onClick={() => onSelect(method)}
          aria-label={`${label}: ${formatVnd(amount)}. Xem chi tiết giao dịch.`} data-testid={testId}>
          {formatVnd(amount)}
        </button>
      </dd>
    </div>
  );
}

function ServiceBreakdownList({ items, label, testId }: {
  items: ServiceDurationDetail[];
  label: string;
  testId: string;
}) {
  return (
    <ul className="service-duration-list" aria-label={label} data-testid={testId}>
      {items.length
        ? items.map((item) => <li key={`${item.serviceType}-${item.minutes}`}>{serviceDurationLabel(item, formatMinutes)}</li>)
        : <li>Chưa có ca dịch vụ</li>}
    </ul>
  );
}

export default function HomePage() {
  const { query, withHistory, permissions, canViewEmployees, canEditServices } = useShell();
  const today = useVietnamToday();
  const search = useSearch();
  const [, navigate] = useLocation();
  const [paymentDetails, setPaymentDetails] = useState<{ method: PaymentMethodFilter; date?: string } | null>(null);
  const { month, date, maxDate, currentMonth, isHistory } = resolveRevenuePeriod(search, today);
  const dayLabel = date === today ? 'hôm nay' : `ngày ${formatShortDate(date)}`;
  const summaryParams = useMemo(() => ({ month, date }), [month, date]);
  const summary = useGetMassageSummary(summaryParams, { query: { queryKey: getGetMassageSummaryQueryKey(summaryParams), enabled: permissions.viewRevenue, refetchOnWindowFocus: true, staleTime: 20_000, refetchInterval: 60_000 } });

  // While searching, the shared SearchResults (mounted in AppShell) replaces the home tiles and report.
  if (query.trim()) return null;

  return (
    <div className="home">
      <div className="tiles">
        {canViewEmployees && <Link href={withHistory('/employees')} className="tile tile-employees" aria-labelledby="employees-link-title" data-testid="link-employees">
          <Users size={28} aria-hidden="true" />
          <strong id="employees-link-title">Quản lý nhân viên</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
        {!isHistory && permissions.viewCards && <Link href="/cards" className="tile tile-cards alt" aria-labelledby="cards-link-title" data-testid="link-cards">
          <CreditCard size={28} aria-hidden="true" />
          <strong id="cards-link-title">Quản lý thẻ</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
        {!isHistory && (permissions.viewAppointments || permissions.editAppointments) && <Link href="/appointments" className="tile tile-appointments alt" aria-labelledby="appointments-link-title" data-testid="link-appointments">
          <CalendarDays size={28} aria-hidden="true" />
          <strong id="appointments-link-title">Lịch hẹn</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
        {!isHistory && canEditServices && <Link href="/services" className="tile tile-services" aria-labelledby="services-link-title" data-testid="link-services-tile">
          <Sparkles size={28} aria-hidden="true" />
          <strong id="services-link-title">Dịch vụ &amp; giá</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
      </div>
      {permissions.viewRevenue && <section className="revenue" aria-labelledby="rev-title" data-testid="section-revenue">
        {isHistory && (
          <div className="revenue-history-controls" data-testid="section-revenue-history">
            <h2>Lịch sử doanh thu</h2>
            <div className="form-grid">
              <label className="field">Tháng
                <input type="month" value={month} max={currentMonth} data-testid="input-revenue-month"
                  onChange={(event) => { if (event.target.value) navigate(`/?month=${event.target.value}`); }} />
              </label>
              <label className="field">Ngày
                <input type="date" value={date} min={`${month}-01`} max={maxDate} data-testid="input-revenue-date"
                  onChange={(event) => { if (event.target.value) navigate(`/?month=${month}&date=${event.target.value}`); }} />
              </label>
            </div>
            <Link href="/" className="btn ghost" data-testid="link-current-revenue">Về tháng hiện tại</Link>
          </div>
        )}
        <div className="revenue-summary" data-testid="revenue-summary">
          {summary.isLoading ? <span className="rev-skel" role="status" aria-label="Đang tải doanh thu" /> : summary.isError
            ? statusCode(summary.error) === 401 || statusCode(summary.error) === 403
              ? <div className="banner danger" role="alert">Tài khoản này không còn quyền xem doanh thu.</div>
              : <ErrorBanner text="Không tải được doanh thu. Hãy thử tải lại; nếu vẫn lỗi, kiểm tra kết nối database của máy chủ." onRetry={() => void summary.refetch()} />
            : summary.data && (
              <>
                <section className="revenue-period-card" aria-labelledby="rev-title" data-testid="revenue-month-summary">
                  <div className="revenue-period-primary-row">
                    <h2 id="rev-title" className="rev-label rev-label-key">Tổng doanh thu cơ sở tháng · {formatMonth(month)}</h2>
                    <p
                      className="rev-value mono"
                      data-testid="text-revenue"
                      tabIndex={0}
                      aria-label={`Tổng doanh thu cơ sở tháng: ${formatVnd(summary.data.revenue)}`}
                    >
                      {formatVnd(summary.data.revenue)}
                    </p>
                  </div>
                  <div className="revenue-period-key-metrics">
                    <div className="net-revenue-row" tabIndex={0}>
                      <span>Tổng doanh thu đã khấu trừ tháng</span>
                      <strong className="mono" data-testid="text-net-revenue">{formatVnd(summary.data.netRevenue)}</strong>
                    </div>
                    <div className="revenue-card-row" tabIndex={0}>
                      <span>Doanh thu bán và nạp thẻ tháng</span>
                      <strong className="mono" data-testid="text-card-revenue">{formatVnd(summary.data.cardRevenue)}</strong>
                    </div>
                  </div>
                  <details className="revenue-details">
                    <summary aria-label="Xem thêm chi tiết doanh thu tháng">Xem thêm</summary>
                    <dl className="rev-breakdown">
                      <div className="service-duration-row" tabIndex={0}>
                        <dt>Ca dịch vụ trong tháng</dt>
                        <dd><ServiceBreakdownList items={summary.data.serviceBreakdown ?? []} label="Chi tiết ca dịch vụ trong tháng" testId="list-facility-month-service-durations" /></dd>
                      </div>
                      <div tabIndex={0}><dt>Doanh thu khách lẻ tháng</dt><dd className="mono" data-testid="text-service-revenue">{formatVnd(summary.data.serviceRevenue)}</dd></div>
                      <PaymentReportRow label="Tiền mặt tháng" amount={summary.data.paymentBreakdown.cash.total} method="cash" testId="button-payment-cash-month" onSelect={(method) => setPaymentDetails({ method })} />
                      <PaymentReportRow label="Chuyển khoản tháng" amount={summary.data.paymentBreakdown.transfer.total} method="transfer" testId="button-payment-transfer-month" onSelect={(method) => setPaymentDetails({ method })} />
                      {summary.data.paymentBreakdown.unrecorded.total > 0 && <PaymentReportRow label="Chưa ghi phương thức tháng" amount={summary.data.paymentBreakdown.unrecorded.total} method="unrecorded" testId="button-payment-unrecorded-month" onSelect={(method) => setPaymentDetails({ method })} />}
                      <div tabIndex={0}><dt>Khách lẻ tháng</dt><dd className="mono" data-testid="text-walk-in-visits">{summary.data.walkInVisits} lượt</dd></div>
                      <div tabIndex={0}><dt>Khách thẻ tháng</dt><dd className="mono" data-testid="text-card-visits">{summary.data.cardVisits} lượt</dd></div>
                      <div data-testid="row-top-service-by-customer-type" tabIndex={0}>
                        <dt>Dịch vụ được dùng nhiều nhất theo loại khách</dt>
                        <dd className="mono">
                          Khách lẻ: {summary.data.mostUsedWalkInService
                            ? `${summary.data.mostUsedWalkInService.serviceType} · ${summary.data.mostUsedWalkInService.visits} lượt`
                            : 'chưa có lượt'}
                          {' · '}
                          Khách thẻ: {summary.data.mostUsedCardService
                            ? `${summary.data.mostUsedCardService.serviceType} · ${summary.data.mostUsedCardService.visits} lượt`
                            : 'chưa có lượt'}
                        </dd>
                      </div>
                      <div data-testid="row-top-sold-card-service" tabIndex={0}>
                        <dt>Gói thẻ bán nhiều nhất tháng</dt>
                        <dd className="mono">{summary.data.topSoldCardService
                          ? `${summary.data.topSoldCardService.serviceType} · ${summary.data.topSoldCardService.cardsSold} thẻ`
                          : 'Chưa có thẻ bán trong tháng'}</dd>
                      </div>
                      <div data-testid="row-most-used-service" tabIndex={0}>
                        <dt>Loại dịch vụ được sử dụng nhiều nhất tháng</dt>
                        <dd className="mono">{summary.data.mostUsedService
                          ? `${summary.data.mostUsedService.serviceType} · ${summary.data.mostUsedService.visits} lượt · ${formatMinutes(summary.data.mostUsedService.minutes)} · khách lẻ và thẻ`
                          : 'Chưa có lượt sử dụng trong tháng'}</dd>
                      </div>
                    </dl>
                  </details>
                </section>

                <section className="revenue-period-card" aria-labelledby="rev-day-title" data-testid="revenue-day-summary">
                  <div className="revenue-period-primary-row">
                    <h2 id="rev-day-title" className="rev-label rev-label-key">Tổng doanh thu ngày · {formatShortDate(date)}</h2>
                    <p
                      className="rev-value mono"
                      data-testid="text-today-revenue"
                      tabIndex={0}
                      aria-label={`Tổng doanh thu ${dayLabel}: ${formatVnd(summary.data.today.revenue)}`}
                    >
                      {formatVnd(summary.data.today.revenue)}
                    </p>
                  </div>
                  <div className="revenue-period-key-metrics">
                    <div className="net-revenue-row" tabIndex={0}>
                      <span>Tổng doanh thu đã khấu trừ {dayLabel}</span>
                      <strong className="mono" data-testid="text-today-net-revenue">{formatVnd(summary.data.today.netRevenue)}</strong>
                    </div>
                    <div className="revenue-card-row" tabIndex={0}>
                      <span>Doanh thu bán và nạp thẻ {dayLabel}</span>
                      <strong className="mono" data-testid="text-today-card-revenue">{formatVnd(summary.data.today.cardRevenue)}</strong>
                    </div>
                  </div>
                  <details className="revenue-details">
                    <summary aria-label={`Xem thêm chi tiết doanh thu ${dayLabel}`}>Xem thêm</summary>
                    <dl className="rev-breakdown">
                      <div className="service-duration-row" tabIndex={0}>
                        <dt>Ca dịch vụ {dayLabel}</dt>
                        <dd><ServiceBreakdownList items={summary.data.today.serviceBreakdown ?? []} label={`Chi tiết ca dịch vụ ${dayLabel}`} testId="list-facility-day-service-durations" /></dd>
                      </div>
                      <div tabIndex={0}><dt>Doanh thu khách lẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-service-revenue">{formatVnd(summary.data.today.serviceRevenue)}</dd></div>
                      <PaymentReportRow label={`Tiền mặt ${dayLabel}`} amount={summary.data.today.paymentBreakdown.cash.total} method="cash" testId="button-payment-cash-day" onSelect={(method) => setPaymentDetails({ method, date })} />
                      <PaymentReportRow label={`Chuyển khoản ${dayLabel}`} amount={summary.data.today.paymentBreakdown.transfer.total} method="transfer" testId="button-payment-transfer-day" onSelect={(method) => setPaymentDetails({ method, date })} />
                      {summary.data.today.paymentBreakdown.unrecorded.total > 0 && <PaymentReportRow label={`Chưa ghi phương thức ${dayLabel}`} amount={summary.data.today.paymentBreakdown.unrecorded.total} method="unrecorded" testId="button-payment-unrecorded-day" onSelect={(method) => setPaymentDetails({ method, date })} />}
                      <div tabIndex={0}><dt>Khách lẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-walk-in-visits">{summary.data.today.walkInVisits} lượt</dd></div>
                      <div tabIndex={0}><dt>Khách thẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-card-visits">{summary.data.today.cardVisits} lượt</dd></div>
                    </dl>
                  </details>
                </section>
              </>
            )}
        </div>
      </section>}
      {paymentDetails && <PaymentDetailsDialog month={month} date={paymentDetails.date} method={paymentDetails.method}
        onClose={() => setPaymentDetails(null)} />}
    </div>
  );
}
