import { useMemo, useState } from 'react';
import { getGetMassageSummaryQueryKey, useGetMassageSummary } from '@workspace/api-client-react';
import { ArrowRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CreditCard, Sparkles, Users } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { useShell } from '@/components/app-shell';
import { DatePickerDialog } from '@/components/date-picker-dialog';
import { HistoryMonthsDialog } from '@/components/history-months-dialog';
import { ErrorBanner } from '@/components/modal';
import { formatShortDate, statusCode } from '@/lib/attendance';
import { formatMinutes, formatMonth, formatVnd } from '@/lib/massage';
import {
  serviceAttendanceLabel,
  summarizeServiceAttendance,
  type ServiceDurationDetail,
} from '@/lib/service-duration-summary';
import { resolveRevenuePeriod, shiftRevenueDate, shiftRevenueDateMonth } from '@/lib/revenue-period';
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
  const totals = summarizeServiceAttendance(items);
  return (
    <ul className="service-duration-list" aria-label={label} data-testid={testId}>
      {totals.length
        ? totals.map((item) => <li key={item.serviceType}>{serviceAttendanceLabel(item, formatMinutes)}</li>)
        : <li>Chưa có ca dịch vụ</li>}
    </ul>
  );
}

export default function HomePage({ revenueOnly = false }: { revenueOnly?: boolean } = {}) {
  const { query, withHistory, permissions, canViewEmployees, canEditServices, period, isOwner, desktopLayout } = useShell();
  const today = period.today;
  const search = useSearch();
  const [location, navigate] = useLocation();
  const [paymentDetails, setPaymentDetails] = useState<{ method: PaymentMethodFilter; date?: string } | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const { month, date, currentMonth } = resolveRevenuePeriod(search, today);
  const homePath = isOwner ? '/' : '/attendance';
  const revenuePath = revenueOnly ? location : homePath;
  const dayLabel = date === today ? 'hôm nay' : `ngày ${formatShortDate(date)}`;
  const summaryParams = useMemo(() => ({ month, date }), [month, date]);
  const summary = useGetMassageSummary(summaryParams, { query: { queryKey: getGetMassageSummaryQueryKey(summaryParams), enabled: permissions.viewRevenue && (!desktopLayout || revenueOnly), refetchOnWindowFocus: true, staleTime: 20_000, refetchInterval: 60_000 } });
  const navigateToRevenueDate = (nextDate: string) => {
    setDatePickerOpen(false);
    setMonthPickerOpen(false);
    navigate(nextDate === today ? revenuePath : `${revenuePath}?month=${nextDate.slice(0, 7)}&date=${nextDate}`);
  };

  // While searching, the shared SearchResults (mounted in AppShell) replaces the home tiles and report.
  if (query.trim() && !revenueOnly) return null;
  const showRevenue = permissions.viewRevenue && (!desktopLayout || revenueOnly);

  return (
    <div className={showRevenue ? `home home-with-revenue${revenueOnly ? ' home-revenue-only' : ''}` : 'home home-actions-only'}>
      {!revenueOnly && <nav className="tiles" aria-label="Chức năng cơ sở">
        {canViewEmployees && <Link href={withHistory('/employees')} className="tile tile-employees" aria-labelledby="employees-link-title" data-testid="link-employees">
          <Users size={28} aria-hidden="true" />
          <strong id="employees-link-title">Quản lý nhân viên</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
        {permissions.viewCards && <Link href="/cards" className="tile tile-cards alt" aria-labelledby="cards-link-title" data-testid="link-cards">
          <CreditCard size={28} aria-hidden="true" />
          <strong id="cards-link-title">Quản lý thẻ</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
        {(permissions.viewAppointments || permissions.editAppointments) && <Link href="/appointments" className="tile tile-appointments alt" aria-labelledby="appointments-link-title" data-testid="link-appointments">
          <CalendarDays size={28} aria-hidden="true" />
          <strong id="appointments-link-title">Lịch hẹn và trạng thái</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
        {canEditServices && <Link href="/services" className="tile tile-services" aria-labelledby="services-link-title" data-testid="link-services-tile">
          <Sparkles size={28} aria-hidden="true" />
          <strong id="services-link-title">Dịch vụ &amp; giá</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
      </nav>}
      {showRevenue && <section className="revenue" aria-labelledby="rev-title" data-testid={revenueOnly ? 'section-desktop-revenue' : 'section-revenue'}>
        <div className="revenue-summary" data-testid="revenue-summary">
          {summary.isLoading ? <span className="rev-skel" role="status" aria-label="Đang tải doanh thu" /> : summary.isError
            ? statusCode(summary.error) === 401 || statusCode(summary.error) === 403
              ? <div className="banner danger" role="alert">Tài khoản này không còn quyền xem doanh thu.</div>
              : <ErrorBanner text="Không tải được doanh thu. Hãy thử tải lại; nếu vẫn lỗi, kiểm tra kết nối database của máy chủ." onRetry={() => void summary.refetch()} />
            : summary.data && (
              <>
                <section className="revenue-period-card" aria-labelledby="rev-title" data-testid="revenue-month-summary">
                  <div className="revenue-period-primary-row">
                    <div className="revenue-month-navigation">
                      <button type="button" className="revenue-period-arrow" aria-label="Tháng trước" data-testid="button-revenue-month-previous"
                        onClick={() => navigateToRevenueDate(shiftRevenueDateMonth(date, -1, today))}>
                        <ChevronLeft size={19} aria-hidden="true" />
                      </button>
                      <h2 id="rev-title" className="rev-label rev-label-key">
                        Tổng doanh thu cơ sở ·{' '}
                        <button type="button" className="revenue-date-trigger" onClick={() => setMonthPickerOpen(true)}
                          aria-label={`Chọn tháng doanh thu, hiện tại ${formatMonth(month)}`} data-testid="button-open-revenue-month-picker">
                          {formatMonth(month)}
                        </button>
                      </h2>
                      <button type="button" className="revenue-period-arrow" aria-label="Tháng sau" data-testid="button-revenue-month-next"
                        disabled={month >= currentMonth}
                        onClick={() => navigateToRevenueDate(shiftRevenueDateMonth(date, 1, today))}>
                        <ChevronRight size={19} aria-hidden="true" />
                      </button>
                    </div>
                    <p
                      className="rev-value mono"
                      data-testid="text-revenue"
                      tabIndex={0}
                      aria-label={`Tổng doanh thu cơ sở tháng ${formatMonth(month)}: ${formatVnd(summary.data.revenue)}`}
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
                  <div className="revenue-service-summary">
                    <span>{summary.data.nightServiceEnabled ? 'Ca dịch vụ thường trong tháng' : 'Ca dịch vụ trong tháng'}</span>
                    <ServiceBreakdownList items={summary.data.serviceBreakdown ?? []} label="Ca dịch vụ theo loại hình trong tháng" testId="list-facility-month-service-durations" />
                  </div>
                  {summary.data.nightServiceEnabled && (
                    <details className="revenue-service-summary night-shift-summary night-service-accordion">
                      <summary>
                        <span>Dịch vụ ca đêm trong tháng</span>
                        <ChevronDown size={18} aria-hidden="true" />
                      </summary>
                      <ServiceBreakdownList items={summary.data.nightShiftBreakdown ?? []} label="Ca đêm muộn theo dịch vụ trong tháng" testId="list-facility-month-night-shifts" />
                    </details>
                  )}
                  <details className="revenue-details">
                    <summary>
                      <span className="revenue-details-closed">Xem chi tiết</span>
                      <span className="revenue-details-open">Ẩn chi tiết</span>
                    </summary>
                    <dl className="rev-breakdown">
                      <PaymentReportRow label="Tiền mặt tháng" amount={summary.data.paymentBreakdown.cash.total} method="cash" testId="button-payment-cash-month" onSelect={(method) => setPaymentDetails({ method })} />
                      <PaymentReportRow label="Chuyển khoản tháng" amount={summary.data.paymentBreakdown.transfer.total} method="transfer" testId="button-payment-transfer-month" onSelect={(method) => setPaymentDetails({ method })} />
                      <div tabIndex={0}><dt>Khách lẻ tháng</dt><dd className="mono" data-testid="text-walk-in-visits">{summary.data.walkInVisits} lượt</dd></div>
                      <div tabIndex={0}><dt>Khách thẻ tháng</dt><dd className="mono" data-testid="text-card-visits">{summary.data.cardVisits} lượt</dd></div>
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
                    <div className="revenue-day-navigation">
                      <button type="button" className="revenue-period-arrow" aria-label="Ngày trước" data-testid="button-revenue-previous-day"
                        onClick={() => navigateToRevenueDate(shiftRevenueDate(date, -1, today))}>
                        <ChevronLeft size={19} aria-hidden="true" />
                      </button>
                      <h2 id="rev-day-title" className="rev-label rev-label-key">
                        Tổng doanh thu ngày ·{' '}
                        <button type="button" className="revenue-date-trigger" onClick={() => setDatePickerOpen(true)}
                          aria-label={`Chọn ngày xem doanh thu, hiện tại ${formatShortDate(date)}`} data-testid="button-open-revenue-date-picker">
                          {formatShortDate(date)}
                        </button>
                      </h2>
                      <button type="button" className="revenue-period-arrow" aria-label="Ngày sau" data-testid="button-revenue-next-day"
                        disabled={date >= today}
                        onClick={() => navigateToRevenueDate(shiftRevenueDate(date, 1, today))}>
                        <ChevronRight size={19} aria-hidden="true" />
                      </button>
                    </div>
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
                  <div className="revenue-service-summary">
                    <span>{summary.data.nightServiceEnabled ? `Ca dịch vụ thường ${dayLabel}` : `Ca dịch vụ ${dayLabel}`}</span>
                    <ServiceBreakdownList items={summary.data.today.serviceBreakdown ?? []} label={`Ca dịch vụ theo loại hình ${dayLabel}`} testId="list-facility-day-service-durations" />
                  </div>
                  {summary.data.nightServiceEnabled && (
                    <details className="revenue-service-summary night-shift-summary night-service-accordion">
                      <summary>
                        <span>Dịch vụ ca đêm {dayLabel}</span>
                        <ChevronDown size={18} aria-hidden="true" />
                      </summary>
                      <ServiceBreakdownList items={summary.data.today.nightShiftBreakdown ?? []} label={`Ca đêm muộn theo dịch vụ ${dayLabel}`} testId="list-facility-day-night-shifts" />
                    </details>
                  )}
                  <details className="revenue-details">
                    <summary>
                      <span className="revenue-details-closed">Xem chi tiết</span>
                      <span className="revenue-details-open">Ẩn chi tiết</span>
                    </summary>
                    <dl className="rev-breakdown">
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
      {showRevenue && datePickerOpen && <DatePickerDialog value={date} title="Chọn ngày xem doanh thu" immediate maxDate={today}
        onClose={() => setDatePickerOpen(false)} onSelect={navigateToRevenueDate} />}
      {showRevenue && monthPickerOpen && <HistoryMonthsDialog title="Chọn tháng doanh thu" listOnly includeCurrentMonth
        onClose={() => setMonthPickerOpen(false)} onPick={(_selectedMonth, selectedDate) => navigateToRevenueDate(selectedDate)} />}
      {showRevenue && paymentDetails && <PaymentDetailsDialog month={month} date={paymentDetails.date} method={paymentDetails.method}
        onClose={() => setPaymentDetails(null)} />}
    </div>
  );
}
