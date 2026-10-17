import { useMemo } from 'react';
import { getGetMassageSummaryQueryKey, useGetMassageSummary } from '@workspace/api-client-react';
import { ArrowRight, CalendarDays, CreditCard, Sparkles, Users } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { useShell } from '@/components/app-shell';
import { ErrorBanner } from '@/components/modal';
import { formatShortDate, statusCode } from '@/lib/attendance';
import { formatMinutes, formatMonth, formatVnd } from '@/lib/massage';
import { resolveRevenuePeriod, vietnamToday } from '@/lib/revenue-period';
import './revenue-history.css';

export default function HomePage() {
  const { query, withHistory, permissions, canViewEmployees, canEditServices } = useShell();
  const today = useMemo(() => vietnamToday(), []);
  const search = useSearch();
  const [, navigate] = useLocation();
  const { month, date, maxDate, currentMonth, isHistory } = resolveRevenuePeriod(search, today);
  const dayLabel = date === today ? 'hôm nay' : `ngày ${formatShortDate(date)}`;
  const summaryParams = useMemo(() => ({ month, date }), [month, date]);
  const summary = useGetMassageSummary(summaryParams, { query: { queryKey: getGetMassageSummaryQueryKey(summaryParams), enabled: permissions.viewRevenue, refetchOnWindowFocus: true, staleTime: 20_000, refetchInterval: 60_000 } });

  // While searching, the shared SearchResults (mounted in AppShell) replaces the home tiles and report.
  if (query.trim()) return null;

  return (
    <div className="home">
      <div className="tiles">
        {canViewEmployees && <Link href={withHistory('/employees')} className="tile" aria-labelledby="employees-link-title" data-testid="link-employees">
          <Users size={28} aria-hidden="true" />
          <strong id="employees-link-title">Quản lý nhân viên</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
        {permissions.viewCards && <Link href="/cards" className="tile alt" aria-labelledby="cards-link-title" data-testid="link-cards">
          <CreditCard size={28} aria-hidden="true" />
          <strong id="cards-link-title">Quản lý thẻ</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
        {(permissions.viewAppointments || permissions.editAppointments) && <Link href="/appointments" className="tile alt" aria-labelledby="appointments-link-title" data-testid="link-appointments">
          <CalendarDays size={28} aria-hidden="true" />
          <strong id="appointments-link-title">Lịch hẹn</strong>
          <span className="tile-go" aria-hidden="true">Mở <ArrowRight size={16} /></span>
        </Link>}
        {canEditServices && <Link href="/services" className="tile" aria-labelledby="services-link-title" data-testid="link-services-tile">
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
        <h1 id="rev-title" className="rev-label rev-label-key">Tổng doanh thu cơ sở · {formatMonth(month)}</h1>
        {summary.isLoading ? <span className="rev-skel" role="status" aria-label="Đang tải doanh thu" /> : summary.isError
          ? statusCode(summary.error) === 401 || statusCode(summary.error) === 403
            ? <div className="banner danger" role="alert">Tài khoản này không còn quyền xem doanh thu.</div>
            : <ErrorBanner text="Không tải được doanh thu. Hãy thử tải lại; nếu vẫn lỗi, kiểm tra kết nối database của máy chủ." onRetry={() => void summary.refetch()} />
          : (
          <>
            <p className="rev-value mono" data-testid="text-revenue">{formatVnd(summary.data?.revenue ?? 0)}</p>
            <dl className="rev-breakdown">
              <div><dt>Doanh thu khách lẻ (tháng)</dt><dd className="mono" data-testid="text-service-revenue">{formatVnd(summary.data?.serviceRevenue ?? 0)}</dd></div>
              <div><dt>Doanh thu bán và nạp thẻ (tháng)</dt><dd className="mono" data-testid="text-card-revenue">{formatVnd(summary.data?.cardRevenue ?? 0)}</dd></div>
              <div className="net-revenue-row rev-key"><dt>Doanh thu đã khấu trừ trong tháng</dt><dd className="mono" data-testid="text-net-revenue"><strong>{formatVnd(summary.data?.netRevenue ?? 0)}</strong></dd></div>
              <div><dt>Khách lẻ (tháng)</dt><dd className="mono" data-testid="text-walk-in-visits">{summary.data?.walkInVisits ?? 0} lượt</dd></div>
              <div><dt>Khách thẻ (tháng)</dt><dd className="mono" data-testid="text-card-visits">{summary.data?.cardVisits ?? 0} lượt</dd></div>
              <div data-testid="row-top-service-by-customer-type">
                <dt>Dịch vụ bán chạy nhất tháng</dt>
                <dd className="mono">
                  Khách lẻ: {summary.data?.mostUsedWalkInService
                    ? `${summary.data.mostUsedWalkInService.serviceType} · ${summary.data.mostUsedWalkInService.visits} lượt`
                    : 'chưa có lượt'}
                  {' · '}
                  Khách thẻ: {summary.data?.mostUsedCardService
                    ? `${summary.data.mostUsedCardService.serviceType} · ${summary.data.mostUsedCardService.visits} lượt`
                    : 'chưa có lượt'}
                </dd>
              </div>
              <div data-testid="row-top-sold-card-service">
                <dt>Gói thẻ bán nhiều nhất tháng</dt>
                <dd className="mono">{summary.data?.topSoldCardService
                  ? `${summary.data.topSoldCardService.serviceType} · ${summary.data.topSoldCardService.cardsSold} thẻ`
                  : 'Chưa có thẻ bán trong tháng'}</dd>
              </div>
              <div data-testid="row-most-used-service">
                <dt>Loại dịch vụ được sử dụng nhiều nhất tháng</dt>
                <dd className="mono">{summary.data?.mostUsedService
                  ? `${summary.data.mostUsedService.serviceType} · ${summary.data.mostUsedService.visits} lượt · ${formatMinutes(summary.data.mostUsedService.minutes)} · khách lẻ và thẻ`
                  : 'Chưa có lượt sử dụng trong tháng'}</dd>
              </div>
              <div className="today-heading rev-key"><dt>Doanh thu {dayLabel}{date === today ? ` · ${formatShortDate(date)}` : ''}</dt><dd className="mono" data-testid="text-today-revenue">{formatVnd(summary.data?.today.revenue ?? 0)}</dd></div>
              <div><dt>Khách lẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-service-revenue">{formatVnd(summary.data?.today.serviceRevenue ?? 0)}</dd></div>
              <div><dt>Bán và nạp thẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-card-revenue">{formatVnd(summary.data?.today.cardRevenue ?? 0)}</dd></div>
              <div className="net-revenue-row rev-key"><dt>Doanh thu đã khấu trừ {dayLabel}</dt><dd className="mono" data-testid="text-today-net-revenue"><strong>{formatVnd(summary.data?.today.netRevenue ?? 0)}</strong></dd></div>
              <div><dt>Khách lẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-walk-in-visits">{summary.data?.today.walkInVisits ?? 0} lượt</dd></div>
              <div><dt>Khách thẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-card-visits">{summary.data?.today.cardVisits ?? 0} lượt</dd></div>
            </dl>
          </>
        )}
      </section>}
    </div>
  );
}
