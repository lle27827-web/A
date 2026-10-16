import { useMemo } from 'react';
import { getGetMassageSummaryQueryKey, useGetMassageSummary } from '@workspace/api-client-react';
import { ArrowRight, CreditCard, Users } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { useShell } from '@/components/app-shell';
import { ErrorBanner } from '@/components/modal';
import { formatShortDate, statusCode } from '@/lib/attendance';
import { formatMonth, formatVnd } from '@/lib/massage';
import { resolveRevenuePeriod, vietnamToday } from '@/lib/revenue-period';
import './revenue-history.css';

export default function HomePage() {
  const { query, withHistory } = useShell();
  const today = useMemo(() => vietnamToday(), []);
  const search = useSearch();
  const [, navigate] = useLocation();
  const { month, date, maxDate, currentMonth, isHistory } = resolveRevenuePeriod(search, today);
  const dayLabel = date === today ? 'hôm nay' : `ngày ${formatShortDate(date)}`;
  const summaryParams = useMemo(() => ({ month, date }), [month, date]);
  const summary = useGetMassageSummary(summaryParams, { query: { queryKey: getGetMassageSummaryQueryKey(summaryParams), refetchOnWindowFocus: true, staleTime: 20_000, refetchInterval: 60_000 } });

  // While searching, the shared SearchResults (mounted in AppShell) replaces the home tiles and report.
  if (query.trim()) return null;

  return (
    <div className="home">
      <div className="tiles">
        <Link href={withHistory('/employees')} className="tile" data-testid="link-employees">
          <Users size={28} aria-hidden="true" />
          <span className="tile-kicker">Kỹ thuật viên · lương theo giờ phục vụ</span>
          <strong>Quản lý nhân viên</strong>
          <span className="tile-go">Mở <ArrowRight size={16} /></span>
        </Link>
        <Link href="/cards" className="tile alt" data-testid="link-cards">
          <CreditCard size={28} aria-hidden="true" />
          <span className="tile-kicker">Thẻ liệu trình · giờ còn lại</span>
          <strong>Quản lý thẻ</strong>
          <span className="tile-go">Mở <ArrowRight size={16} /></span>
        </Link>
      </div>
      <section className="revenue" aria-labelledby="rev-title" data-testid="section-revenue">
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
            ? <div className="banner danger" role="alert">Chỉ chủ sở hữu mới xem được doanh thu. <Link href="/sign-in" className="link-strong">Đăng nhập chủ sở hữu</Link></div>
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
              <div className="today-heading rev-key"><dt>Doanh thu {dayLabel}{date === today ? ` · ${formatShortDate(date)}` : ''}</dt><dd className="mono" data-testid="text-today-revenue">{formatVnd(summary.data?.today.revenue ?? 0)}</dd></div>
              <div><dt>Khách lẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-service-revenue">{formatVnd(summary.data?.today.serviceRevenue ?? 0)}</dd></div>
              <div><dt>Bán và nạp thẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-card-revenue">{formatVnd(summary.data?.today.cardRevenue ?? 0)}</dd></div>
              <div className="net-revenue-row rev-key"><dt>Doanh thu đã khấu trừ {dayLabel}</dt><dd className="mono" data-testid="text-today-net-revenue"><strong>{formatVnd(summary.data?.today.netRevenue ?? 0)}</strong></dd></div>
              <div><dt>Khách lẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-walk-in-visits">{summary.data?.today.walkInVisits ?? 0} lượt</dd></div>
              <div><dt>Khách thẻ {dayLabel}</dt><dd className="mono" data-testid="text-today-card-visits">{summary.data?.today.cardVisits ?? 0} lượt</dd></div>
            </dl>
            <p className="hint">Doanh thu đã khấu trừ = tiền dịch vụ khách lẻ + tiền bán, nạp thẻ − tiền công ca khách lẻ. Ca dùng thẻ chỉ ghi tiền công vào lương nhân viên, không làm thay đổi dòng doanh thu này.</p>
          </>
        )}
      </section>
    </div>
  );
}
