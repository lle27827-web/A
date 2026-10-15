import { useMemo } from 'react';
import { getGetMassageSummaryQueryKey, useGetMassageSummary } from '@workspace/api-client-react';
import { ArrowRight, CreditCard, Users } from 'lucide-react';
import { Link } from 'wouter';
import { useShell } from '@/components/app-shell';
import { ErrorBanner } from '@/components/modal';
import { formatShortDate } from '@/lib/attendance';
import { formatMinutes, formatMonth, formatVnd, monthOf } from '@/lib/massage';

export default function HomePage() {
  const { query } = useShell();
  const today = useMemo(() => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }, []);
  const month = monthOf(today);
  const summaryParams = useMemo(() => ({ month, date: today }), [month, today]);
  const summary = useGetMassageSummary(summaryParams, { query: { queryKey: getGetMassageSummaryQueryKey(summaryParams), refetchOnWindowFocus: true, staleTime: 20_000, refetchInterval: 60_000 } });

  // While searching, the shared SearchResults (mounted in AppShell) replaces the home tiles and report.
  if (query.trim()) return null;

  return (
    <div className="home">
      <div className="tiles">
        <Link href="/employees" className="tile" data-testid="link-employees">
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
        <h1 id="rev-title" className="rev-label">Tổng doanh thu cơ sở · {formatMonth(month)}</h1>
        {summary.isLoading ? <span className="rev-skel" role="status" aria-label="Đang tải doanh thu" /> : summary.isError ? <ErrorBanner text="Không tải được doanh thu." onRetry={() => void summary.refetch()} /> : (
          <>
            <p className="rev-value mono" data-testid="text-revenue">{formatVnd(summary.data?.revenue ?? 0)}</p>
            <dl className="rev-breakdown">
              <div><dt>Doanh thu khách lẻ (tháng)</dt><dd className="mono" data-testid="text-service-revenue">{formatVnd(summary.data?.serviceRevenue ?? 0)}</dd></div>
              <div><dt>Doanh thu bán thẻ (tháng)</dt><dd className="mono" data-testid="text-card-revenue">{formatVnd(summary.data?.cardRevenue ?? 0)}</dd></div>
              <div className="net-revenue-row"><dt>Tiền công nhân viên (tháng)</dt><dd className="net-revenue-values"><strong className="mono" data-testid="text-payroll">{formatVnd(summary.data?.payroll ?? 0)}</strong><span>Gồm ca khách lẻ và ca dùng thẻ</span></dd></div>
              <div><dt>Khách lẻ (tháng)</dt><dd className="mono" data-testid="text-walk-in-visits">{summary.data?.walkInVisits ?? 0} lượt</dd></div>
              <div><dt>Khách thẻ (tháng)</dt><dd className="mono" data-testid="text-card-visits">{summary.data?.cardVisits ?? 0} lượt</dd></div>
              <div className="today-heading"><dt>Doanh thu hôm nay · {formatShortDate(today)}</dt><dd className="mono" data-testid="text-today-revenue">{formatVnd(summary.data?.today.revenue ?? 0)}</dd></div>
              <div><dt>Khách lẻ hôm nay</dt><dd className="mono" data-testid="text-today-service-revenue">{formatVnd(summary.data?.today.serviceRevenue ?? 0)}</dd></div>
              <div><dt>Bán thẻ hôm nay</dt><dd className="mono" data-testid="text-today-card-revenue">{formatVnd(summary.data?.today.cardRevenue ?? 0)}</dd></div>
              <div className="net-revenue-row"><dt>Tiền công nhân viên hôm nay</dt><dd className="net-revenue-values"><strong className="mono" data-testid="text-today-payroll">{formatVnd(summary.data?.today.payroll ?? 0)}</strong><span>Gồm ca khách lẻ và ca dùng thẻ</span></dd></div>
              <div><dt>Khách lẻ hôm nay</dt><dd className="mono" data-testid="text-today-walk-in-visits">{summary.data?.today.walkInVisits ?? 0} lượt</dd></div>
              <div><dt>Khách thẻ hôm nay</dt><dd className="mono" data-testid="text-today-card-visits">{summary.data?.today.cardVisits ?? 0} lượt</dd></div>
            </dl>
            <p className="hint">Doanh thu gồm giá khách lẻ và tiền bán thẻ theo ngày mua; lượt dùng thẻ không cộng doanh thu lần nữa. Tiền công nhân viên được thống kê riêng theo các ca đang hoạt động.</p>
          </>
        )}
      </section>
    </div>
  );
}
